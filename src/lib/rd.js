import proj4 from 'proj4'

// Rijksdriehoeksstelsel (RD New). Oblique stereographic on Bessel 1841 with the
// 7-parameter Bessel -> WGS84 datum shift (decimetre accuracy; not for legal survey).
// RD(155000, 463000) is the Amersfoort origin.
export const RD_CRS = 'EPSG:28992'
export const WGS84_CRS = 'EPSG:4326'

proj4.defs(
  RD_CRS,
  '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 ' +
    '+x_0=155000 +y_0=463000 +ellps=bessel ' +
    '+towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 ' +
    '+units=m +no_defs',
)

/** [lon, lat] -> [x, y] RD metres. proj4 is always lon-first. */
export function wgs84ToRd([lon, lat]) {
  return proj4(WGS84_CRS, RD_CRS, [lon, lat])
}

/** [x, y] RD metres -> [lon, lat]. */
export function rdToWgs84([x, y]) {
  return proj4(RD_CRS, WGS84_CRS, [x, y])
}

/** Leaflet-friendly: (lat, lng) -> [x, y] RD metres. */
export function latLngToRd(lat, lng) {
  return wgs84ToRd([lng, lat])
}

/** RD metres -> { lat, lng }. */
export function rdToLatLng([x, y]) {
  const [lng, lat] = rdToWgs84([x, y])
  return { lat, lng }
}

/** Exact planar distance in metres between two RD points. */
export function rdDistance([x0, y0], [x1, y1]) {
  return Math.hypot(x1 - x0, y1 - y0)
}

/** Absolute planar area (m²) of a closed RD ring (shoelace). */
export function rdRingArea(ring) {
  let twice = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return Math.abs(twice) / 2
}

/** Convert a [lon, lat] ring (e.g. GeoJSON from the WFS) to an RD ring. */
export function ringToRd(lonLatRing) {
  return lonLatRing.map(wgs84ToRd)
}

/**
 * Parcel-local frame (translate-only; fine at parcel scale).
 * Axes: X = RD +X (east), Y = up (NAP metres), Z = -(RD +Y) (south),
 * so three.js's default view direction (-Z) faces north.
 *
 * @param {Array<[number, number]>} outerRing RD metres
 */
export function createParcelFrame(outerRing) {
  const [cx, cy] = ringMean(outerRing)
  return {
    centroid: [cx, cy],
    toLocal: ([x, y], napZ = 0) => ({ x: x - cx, y: napZ, z: -(y - cy) }),
    fromLocal: ({ x, z }) => [x + cx, cy - z],
  }
}

function ringMean(ring) {
  // Drop the closing duplicate so it is not double-weighted.
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring
  const n = pts.length || 1
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
}
