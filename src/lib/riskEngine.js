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

// TODO(real-data): add rotterdam_soil_types.json (Bodemkaart) + real dijkring
// polygons. Until then, containment runs against mockFloodZones.json and
// subsidence falls back to an elevation heuristic (flagged as mock).

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

async function getElevation(lat, lng, signal) {
  try {
    const [x, y] = proj4('EPSG:4326', 'EPSG:28992', [lng, lat])
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
        console.warn(`[riskEngine] elevation attempt failed (${source}):`, e?.message)
      }
    }
    return { value: mockElevation(lat, lng), isMock: true, source: 'mock:pdok-fallback' }
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    console.warn('[riskEngine] PDOK elevation failed, using mock:', e?.message)
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

function riskBand(overall) {
  return overall >= 66 ? 'high' : overall >= 34 ? 'medium' : 'low'
}

export async function calculateParcelMetrics(lat, lng, signal) {
  const { value: elevation, isMock, source } = await getElevation(lat, lng, signal)

  const feature = findContainingFeature(lng, lat)
  const flood = calculateFloodScore(feature, elevation)
  const subsidence = calculateSubsidenceScore(feature, elevation)
  const fire = 30 // estimate: proximity logic not yet implemented
  const overall = Math.round(flood * 0.5 + subsidence * 0.3 + fire * 0.2)

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

  return {
    lat,
    lng,
    flood,
    subsidence,
    fire,
    overall,
    riskBand: riskBand(overall),
    risks: { flood, subsidence, fire },
    valuation: baseValue,
    elevation,
    isMockElevation: isMock,
    elevationSource: source,
    depreciation,
  }
}
