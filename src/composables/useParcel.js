import { ref, watch, unref, onUnmounted } from 'vue'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import { isInNetherlands } from './useGeocoding.js'

// PDOK Kadastrale Kaart WFS v5 — keyless, CORS-enabled. `srsName=EPSG:4326` with a
// CRS84 bbox suffix keeps the coordinates in lon,lat (matching Leaflet/turf). A
// generous `count` is required: parcels are small and dense, so a low count can
// truncate the result before the parcel that actually contains the point.
const WFS_URL = 'https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0'
const BBOX_CRS = 'urn:ogc:def:crs:OGC:1.3:CRS84'
const BBOX_PAD_DEG = 0.00025 // ~28 m north/south; widened in longitude by cos(lat)
const WFS_COUNT = 25
// A click that lands on a shared parcel boundary (or a narrow road sliver) has
// no single containing polygon. We then fall back to the nearest parcel
// centroid — but only within this radius, so clicks on open water/roads still
// report "no parcel" instead of snapping to a distant shape.
const NEAREST_PARCEL_MAX_M = 50

function debounce(fn, delay) {
  let timeoutId
  const wrapped = (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
  wrapped.cancel = () => clearTimeout(timeoutId)
  return wrapped
}

/** Small lon,lat bbox around a point, sized so the containing parcel is included. */
function buildBbox(lat, lng) {
  const dLng = BBOX_PAD_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const box = [lng - dLng, lat - BBOX_PAD_DEG, lng + dLng, lat + BBOX_PAD_DEG]
    .map((n) => Number(n.toFixed(6)))
    .join(',')
  return `${box},${BBOX_CRS}`
}

export function buildParcelUrl(lat, lng) {
  return (
    `${WFS_URL}?service=WFS&version=2.0.0&request=GetFeature` +
    '&typeName=kadastralekaartv5:perceel' +
    '&outputFormat=application/json' +
    '&srsName=EPSG:4326' +
    `&bbox=${buildBbox(lat, lng)}` +
    `&count=${WFS_COUNT}`
  )
}

/** Shoelace centroid of a linear ring; vertex mean when the ring is degenerate. */
function ringCentroid(ring) {
  let twiceArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]
    const [x1, y1] = ring[i]
    const cross = x0 * y1 - x1 * y0
    twiceArea += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (twiceArea !== 0) return [cx / (3 * twiceArea), cy / (3 * twiceArea)]
  const n = ring.length || 1
  return [ring.reduce((s, c) => s + c[0], 0) / n, ring.reduce((s, c) => s + c[1], 0) / n]
}

function ringTwiceArea(ring) {
  let twiceArea = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]
    const [x1, y1] = ring[i]
    twiceArea += x0 * y1 - x1 * y0
  }
  return twiceArea
}

/** Representative [lng, lat] centroid of a Polygon/MultiPolygon (largest outer ring). */
function featureCentroid(feature) {
  const g = feature?.geometry
  if (!g) return null
  const polygons =
    g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
  let best = null
  let bestArea = -1
  for (const poly of polygons) {
    const ring = poly?.[0]
    if (!Array.isArray(ring) || ring.length < 3) continue
    const area = Math.abs(ringTwiceArea(ring))
    if (area > bestArea) {
      bestArea = area
      best = ringCentroid(ring)
    }
  }
  return best
}

/** Rough metres between two [lng, lat] points (equirectangular — fine at parcel scale). */
function metresBetween(a, b) {
  const mPerLat = 111320
  const mPerLng = mPerLat * Math.cos((a[1] * Math.PI) / 180)
  return Math.hypot((b[0] - a[0]) * mPerLng, (b[1] - a[1]) * mPerLat)
}

/**
 * Choose the parcel for a clicked [lng, lat]:
 *   1. exact containment — @turf/boolean-point-in-polygon handles `Polygon` *and*
 *      `MultiPolygon` — so we always get the polygon the click sits inside, then
 *   2. nearest polygon centroid, within NEAREST_PARCEL_MAX_M, for clicks on a
 *      boundary, a road sliver or a gap between shapes.
 * Returns `{ feature, match, distanceM? }`, or null when nothing is close enough.
 */
export function pickParcel(features, lat, lng) {
  if (!features?.length) return null
  const point = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }
  const containing = features.find((f) => booleanPointInPolygon(point, f))
  if (containing) return { feature: containing, match: 'contains' }

  const click = [lng, lat]
  let nearest = null
  let nearestDistance = Infinity
  for (const f of features) {
    const c = featureCentroid(f)
    if (!c) continue
    const d = metresBetween(click, c)
    if (d < nearestDistance) {
      nearestDistance = d
      nearest = f
    }
  }
  if (nearest && nearestDistance <= NEAREST_PARCEL_MAX_M) {
    return { feature: nearest, match: 'nearest-centroid', distanceM: Math.round(nearestDistance) }
  }
  return null
}

/** Normalise the OGC feature into the cadastral fields the UI needs. */
export function parseParcel(feature) {
  if (!feature) return { properties: null, area: null }
  const p = feature.properties ?? {}
  const area = Number(p.kadastraleGrootteWaarde)
  const hasArea = Number.isFinite(area)
  return {
    properties: {
      id: [p.kadastraleGemeenteCode, p.sectie, p.perceelnummer].filter(Boolean).join('-') || null,
      gemeenteCode: p.kadastraleGemeenteCode ?? null,
      gemeente: p.kadastraleGemeenteWaarde ?? null,
      sectie: p.sectie ?? null,
      perceelnummer: p.perceelnummer ?? null,
      area: hasArea ? area : null,
    },
    area: hasArea ? area : null,
  }
}

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] }

function fallbackResult(reason) {
  return { geojson: EMPTY_GEOJSON, properties: null, area: null, match: null, isFallback: true, reason }
}

async function fetchParcel(lat, lng, signal) {
  if (!isInNetherlands(lat, lng)) return fallbackResult('outside-nl')
  const res = await fetch(buildParcelUrl(lat, lng), { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Kadaster WFS ${res.status}`)
  const geojson = await res.json()
  const features = geojson?.features ?? []
  const picked = pickParcel(features, lat, lng)
  const { properties, area } = parseParcel(picked?.feature)
  return {
    geojson: geojson?.type === 'FeatureCollection' ? geojson : EMPTY_GEOJSON,
    properties,
    area,
    match: picked?.match ?? null,
    distanceM: picked?.distanceM ?? null,
    isFallback: false,
    reason: picked ? null : 'no-containing-parcel',
  }
}

/**
 * Reactively fetch the cadastral parcel (plus neighbours) for a coordinate.
 * `data` is null only while loading; on failure it resolves to a fallback
 * object so downstream metric computation always has something to work with.
 */
export function useParcel(latRef, lngRef) {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)
  let controller = null

  const run = async (lat, lng) => {
    if (lat == null || lng == null) return
    if (controller) controller.abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = null
    data.value = null
    try {
      const result = await fetchParcel(lat, lng, current.signal)
      if (controller !== current) return
      data.value = result
    } catch (err) {
      if (err?.name === 'AbortError') return
      if (controller !== current) return
      error.value = err?.message || 'Failed to fetch parcel'
      data.value = fallbackResult('request-failed')
    } finally {
      if (controller === current) loading.value = false
    }
  }

  const debouncedRun = debounce(run, 250)

  const stopWatch = watch(
    [() => unref(latRef), () => unref(lngRef)],
    ([lat, lng]) => debouncedRun(lat, lng),
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatch()
    debouncedRun.cancel()
    if (controller) controller.abort()
  })

  return { data, loading, error }
}
