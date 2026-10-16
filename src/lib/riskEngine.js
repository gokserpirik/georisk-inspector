import bbox from '@turf/bbox'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import Flatbush from 'flatbush'
import proj4 from 'proj4'
import floodZones from '../data/mockFloodZones.json'

// RD New (EPSG:28992) — required by Dutch national APIs (PDOK)
proj4.defs(
  'EPSG:28992',
  '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs',
)

/**
 * WGS84 (lat, lng) → RD New (EPSG:28992) easting/northing in whole metres.
 * Same transform the AHN sampling uses, so the drawer's X/Y matches the raster.
 * Returns null on invalid input.
 */
export function toRd(lat, lng) {
  try {
    const [x, y] = proj4('EPSG:4326', 'EPSG:28992', [lng, lat])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x: Math.round(x), y: Math.round(y) }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic Risk Index (Prototype): transparent, documented weights.
//   Risk Index = Σ (wᵢ × sᵢ)   with Σ wᵢ = 1.0 and sᵢ ∈ [0, 100]
// Each factor reports its raw input, unit, weight, sub-score and data source so
// the UI can show exactly how the number was produced. This is NOT an actuarial
// model: hydrological weights are simulated around live PDOK cadastral geometry.
// ─────────────────────────────────────────────────────────────────────────────
export const RISK_FORMULA = 'Σ (wᵢ × sᵢ)'

export const RISK_WEIGHTS = {
  flood: 0.4,
  subsidence: 0.25,
  fire: 0.15,
  area: 0.2,
}

const SOURCE = {
  pdok: 'PDOK Kadaster WFS',
  proxy: 'Heuristic Proxy',
}

// TODO(real-data): add rotterdam_soil_types.json (Bodemkaart) + real dijkring
// polygons. Until then, containment runs against mockFloodZones.json and
// subsidence falls back to an elevation heuristic (flagged as a proxy).

function buildSpatialIndex(geojson) {
  const index = new Flatbush(geojson.features.length)
  for (const feature of geojson.features) {
    const b = bbox(feature)
    index.add(b[0], b[1], b[2], b[3])
  }
  index.finish()
  return index
}

const floodIndex = buildSpatialIndex(floodZones)

/** R-tree prefilter (bbox) + exact point-in-polygon. Returns feature or null. */
function findContainingFeature(lng, lat) {
  const candidates = floodIndex.search(lng, lat, lng, lat)
  const pt = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }
  for (const i of candidates) {
    if (booleanPointInPolygon(pt, floodZones.features[i])) return floodZones.features[i]
  }
  return null
}

/**
 * Real elevation via PDOK AHN WMS GetFeatureInfo (endpoint
 * `rws/ahn/wms/v1_0`, layer `dtm_05m` — the only working combination;
 * versioned ahn4/ahn5 service paths 404).
 * Primary: WMS 1.1.1 5x5 px over ±2.5 m (verified at Leiden where the
 * 1.3.0 form returns empty). Fallback: WMS 1.3.0 101x101 over ±25 m.
 * Returns { value, isMock, source }; throws AbortError on cancellation.
 */
function extractElevationValue(data) {
  const features = data?.features ?? []
  const preferredKeys = [
    'value_list',
    'GRAY_INDEX',
    'Gray_Index',
    'gray_index',
    'BAND1',
    'Band1',
    'band1',
    'value',
    'Value',
    'dtm_05m',
  ]
  for (const feature of features) {
    const props = feature?.properties ?? {}
    for (const key of preferredKeys) {
      const v = Number(String(props[key] ?? '').split(',')[0])
      if (Number.isFinite(v) && v > -500 && v < 1000) return v
    }
    for (const raw of Object.values(props)) {
      const v = Number(String(raw).split(',')[0])
      if (Number.isFinite(v) && v > -500 && v < 1000) return v
    }
  }
  return null
}

async function queryPdok(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`PDOK ${res.status}`)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`PDOK non-JSON: ${text.slice(0, 120)}`)
  }
  const v = extractElevationValue(data)
  if (v === null) throw new Error('PDOK empty result')
  return Math.round(v * 10) / 10
}

// AHN dtm_05m returns no feature over parts of NL (raster nodata / masked cells),
// so the deterministic mock is used there. Note that once, not on every recompute.
let elevationFallbackNoted = false
function noteElevationFallback() {
  if (elevationFallbackNoted) return
  elevationFallbackNoted = true
  console.info(
    '[riskEngine] AHN dtm_05m has no data at this point; using deterministic mock elevation (drawer shows a "mock data" badge).',
  )
}

async function getElevation(lat, lng, signal, rd = null) {
  try {
    const [x, y] = rd ? [rd.x, rd.y] : proj4('EPSG:4326', 'EPSG:28992', [lng, lat])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { value: mockElevation(lat, lng), isMock: true, source: 'mock:invalid-projection' }
    }
    const base = 'https://service.pdok.nl/rws/ahn/wms/v1_0?SERVICE=WMS&REQUEST=GetFeatureInfo'
    const attempts = [
      {
        source: 'pdok:dtm_05m-1.1.1',
        // 5x5 px over ±2.5 m; X/Y pixel addressing per WMS 1.1.1
        url:
          `${base}&VERSION=1.1.1&SRS=EPSG:28992&BBOX=${x - 2.5},${y - 2.5},${x + 2.5},${y + 2.5}` +
          '&WIDTH=5&HEIGHT=5&X=2&Y=2&LAYERS=dtm_05m&QUERY_LAYERS=dtm_05m' +
          '&STYLES=&FORMAT=image%2Fpng&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=10',
      },
      {
        source: 'pdok:dtm_05m-1.3.0',
        url:
          `${base}&VERSION=1.3.0&CRS=EPSG:28992&BBOX=${x - 25},${y - 25},${x + 25},${y + 25}` +
          '&WIDTH=101&HEIGHT=101&I=50&J=50&LAYERS=dtm_05m&QUERY_LAYERS=dtm_05m' +
          '&INFO_FORMAT=application%2Fjson',
      },
    ]
    for (const { source, url } of attempts) {
      try {
        return { value: await queryPdok(url, signal), isMock: false, source }
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        // Coverage gap at this point — fall through to the next attempt.
      }
    }
    noteElevationFallback()
    return { value: mockElevation(lat, lng), isMock: true, source: 'mock:pdok-fallback' }
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    noteElevationFallback()
    return { value: mockElevation(lat, lng), isMock: true, source: 'mock:pdok-error' }
  }
}

/** Deterministic fallback elevation (Rotterdam sits near/below NAP). No PRNG. */
function mockElevation(lat, lng) {
  const h = Math.sin(lat * 12.9898 + lng * 78.233) * 43758.5453
  const frac = h - Math.floor(h)
  return Math.round((-2 + frac * 16) * 10) / 10
}

function calculateFloodScore(feature, elevation) {
  if (feature && elevation < 0) return 90
  if (feature && elevation >= 0) return 60
  if (!feature && elevation < 2) return 40
  return 10
}

function calculateSubsidenceScore(feature, elevation) {
  // Real Bodemkaart polygons carry a soil `type`; mock polygons don't.
  const soilType = feature?.properties?.type?.toLowerCase()
  if (soilType) return { veen: 85, klei: 50, zand: 15 }[soilType] ?? 20
  if (elevation < 0) return 70
  if (elevation < 2) return 45
  return 20
}

/**
 * Parcel area / imperviousness. Smaller, denser parcels imply more sealed
 * surface and higher runoff/flood exposure. Uses the live cadastral area when
 * available, otherwise a fixed heuristic.
 */
function calculateAreaScore(area) {
  if (!Number.isFinite(area) || area <= 0) return { score: 45, source: SOURCE.proxy }
  let score
  if (area <= 200) score = 80
  else if (area >= 1000) score = 20
  else score = Math.round(80 - ((area - 200) / 800) * 60)
  return { score, source: SOURCE.pdok }
}

function riskBand(overall) {
  return overall >= 66 ? 'high' : overall >= 34 ? 'medium' : 'low'
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {{ signal?: AbortSignal, parcel?: { area?: number|null, properties?: object|null, isFallback?: boolean } }} [options]
 */
export async function calculateParcelMetrics(lat, lng, options = {}) {
  const { signal, parcel = null } = options
  const rd = toRd(lat, lng)
  const { value: elevation, isMock, source: elevationSource } = await getElevation(lat, lng, signal, rd)

  const feature = findContainingFeature(lng, lat)
  const flood = calculateFloodScore(feature, elevation)
  const subsidence = calculateSubsidenceScore(feature, elevation)
  const fire = 30 // estimate: proximity logic not yet implemented
  const areaScore = calculateAreaScore(parcel?.area ?? null)

  // Live cadastral geometry drives the area factor; elevation may be live or mock.
  const elevationIsLive = !isMock
  const breakdown = [
    {
      id: 'flood',
      label: 'Flood Zone / Water Proximity',
      description: 'Mapped water-zone exposure; risk rises where ground sits near or below NAP.',
      rawValue: feature?.properties?.name ?? 'outside mapped zones',
      unit: '',
      weight: RISK_WEIGHTS.flood,
      subScore: flood,
      source: SOURCE.proxy,
    },
    {
      id: 'subsidence',
      label: 'Subsidence (soil / elevation proxy)',
      description: 'Soil-settlement proxy: peat and klei, and ground below ~2 m NAP, score higher.',
      rawValue: elevation,
      unit: 'm NAP',
      weight: RISK_WEIGHTS.subsidence,
      subScore: subsidence,
      source: SOURCE.proxy,
    },
    {
      id: 'fire',
      label: 'Fire (estimate)',
      description: 'Flat estimate; a proximity model is not yet implemented.',
      rawValue: 'not yet modelled',
      unit: '',
      weight: RISK_WEIGHTS.fire,
      subScore: fire,
      source: SOURCE.proxy,
    },
    {
      id: 'area',
      label: 'Parcel Area / Imperviousness',
      description: 'Small, dense parcels imply more sealed surface and higher runoff.',
      rawValue: Number.isFinite(parcel?.area) ? parcel.area : null,
      unit: 'm²',
      weight: RISK_WEIGHTS.area,
      subScore: areaScore.score,
      source: areaScore.source,
    },
  ]

  const overall = Math.round(
    breakdown.reduce((sum, f) => sum + f.weight * f.subScore, 0),
  )

  // Fixed base until Kadaster/WOZ lookup lands; per-parcel uniqueness comes
  // from the spatial sin-hash noise below (no PRNG).
  const baseValue = 450000
  const startYear = new Date().getFullYear()
  const depreciation = []
  let value = baseValue
  for (let i = 0; i < 10; i++) {
    depreciation.push({ year: startYear + i, value: Math.round(value) })
    const h = Math.sin(lat * 12.9898 + lng * 78.233 + i) * 43758.5453
    const noise = (h - Math.floor(h)) * 0.004
    value *= 1 - (overall / 100) * 0.012 - noise
  }

  const risks = { flood, subsidence, fire, area: areaScore.score }

  return {
    lat,
    lng,
    rd,
    flood,
    subsidence,
    fire,
    area: areaScore.score,
    overall,
    index: overall,
    band: riskBand(overall),
    riskBand: riskBand(overall),
    risks,
    breakdown,
    formula: RISK_FORMULA,
    parcel: parcel?.properties ?? null,
    parcelArea: Number.isFinite(parcel?.area) ? parcel.area : null,
    isFallbackParcel: parcel?.isFallback ?? true,
    valuation: baseValue,
    elevation,
    isMockElevation: isMock,
    elevationIsLive,
    elevationSource,
    depreciation,
  }
}
