import { createParcelFrame, ringToRd, rdRingArea } from './rd.js'

// ─────────────────────────────────────────────────────────────────────────────
// Pure geometry + raster helpers for the 3D parcel slice. Everything here works
// in RD metres (x east, y north) and NAP heights, with no DOM/three.js, so it is
// unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_BUILDING_HEIGHT = 2
export const DEFAULT_BUILDING_HEIGHT = 6

/** Ray-casting point-in-ring (ring may be closed or open). */
export function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function ringBounds(ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

function isValidHeight(v) {
  return Number.isFinite(v) && Math.abs(v) < 1e4
}

/**
 * Georeferenced north-up height raster (e.g. an AHN GeoTIFF).
 * `bbox` = [minX, minY, maxX, maxY] of the whole raster in RD metres; row 0 is
 * the northern edge. Nodata cells are NaN / huge sentinel values.
 */
export function createRaster({ width, height, bbox, data }) {
  const [minX, minY, maxX, maxY] = bbox
  const dx = (maxX - minX) / width
  const dy = (maxY - minY) / height

  const at = (col, row) => {
    if (col < 0 || row < 0 || col >= width || row >= height) return null
    const v = data[row * width + col]
    return isValidHeight(v) ? v : null
  }

  /** Bilinear sample at an RD point; nodata neighbours are skipped. Null if none valid. */
  function sample(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < minX || x > maxX || y < minY || y > maxY) return null
    const fc = (x - minX) / dx - 0.5
    const fr = (maxY - y) / dy - 0.5
    const c0 = Math.floor(fc)
    const r0 = Math.floor(fr)
    const tc = fc - c0
    const tr = fr - r0
    let sum = 0
    let weight = 0
    for (const [c, r, w] of [
      [c0, r0, (1 - tc) * (1 - tr)],
      [c0 + 1, r0, tc * (1 - tr)],
      [c0, r0 + 1, (1 - tc) * tr],
      [c0 + 1, r0 + 1, tc * tr],
    ]) {
      const v = at(c, r)
      if (v !== null && w > 0) {
        sum += v * w
        weight += w
      }
    }
    return weight > 0 ? sum / weight : null
  }

  return { width, height, bbox, data, sample }
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]
}

/**
 * Derive a building's NAP heights from AHN: ground = median DTM under the
 * footprint, roof = 70th percentile of (DSM − DTM) added to ground (the same
 * statistic 3DBAG publishes as h_dak_70p). BAG `pand` carries no heights, so
 * AHN is the source. Returns null heights when the rasters have no data there.
 */
export function buildingHeights(outer, dsm, dtm, holes = []) {
  const [minX, minY, maxX, maxY] = ringBounds(outer)
  const area = Math.max(rdRingArea(outer), 1)
  const step = Math.max(0.5, Math.sqrt(area / 400))
  const ground = []
  const rel = []
  let samples = 0
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (!pointInRing(x, y, outer) || holes.some((hole) => pointInRing(x, y, hole))) continue
      samples++
      const g = dtm.sample(x, y)
      const s = dsm.sample(x, y)
      if (g === null) continue
      ground.push(g)
      if (s !== null) rel.push(s - g)
    }
  }
  ground.sort((a, b) => a - b)
  rel.sort((a, b) => a - b)
  const groundNap = percentile(ground, 0.5)
  const h70 = percentile(rel, 0.7)
  const coverage = samples ? rel.length / samples : 0
  if (groundNap === null) return { groundNap: null, baseNap: null, roofNap: null, height: null, coverage }
  const height = h70 === null ? null : Math.max(MIN_BUILDING_HEIGHT, h70)
  return {
    groundNap,
    // Sink the base below the lowest ground sample so walls never float on slopes.
    baseNap: ground[0] - 0.3,
    roofNap: height === null ? null : groundNap + height,
    height,
    coverage,
  }
}

/** Split a Polygon/MultiPolygon geometry into `{ outer, holes }` RD parts (input in RD already). */
export function polygonParts(geometry) {
  if (!geometry) return []
  const polys =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : []
  return polys.filter((p) => p?.[0]?.length >= 4).map((p) => ({ outer: p[0], holes: p.slice(1) }))
}

/**
 * Turn BAG `pand` features (EPSG:28992) into slice buildings with AHN heights.
 * Buildings without usable AHN data get DEFAULT_BUILDING_HEIGHT on the supplied
 * fallback ground and are flagged `estimated`.
 */
export function buildBuildings(features, dsm, dtm, fallbackGround) {
  const out = []
  for (const f of features ?? []) {
    polygonParts(f.geometry).forEach((part, i) => {
      const h = buildingHeights(part.outer, dsm, dtm, part.holes)
      const estimated = h.height === null || h.groundNap === null || h.coverage < 1
      const groundNap = h.groundNap ?? fallbackGround
      const height = h.height ?? DEFAULT_BUILDING_HEIGHT
      out.push({
        id: `${f.properties?.identificatie ?? f.id ?? 'pand'}${i ? `-${i}` : ''}`,
        outer: part.outer,
        holes: part.holes,
        groundNap,
        baseNap: h.baseNap ?? groundNap - 0.3,
        roofNap: groundNap + height,
        height,
        bouwjaar: f.properties?.bouwjaar ?? null,
        estimated,
        coverage: h.coverage,
      })
    })
  }
  return out
}

/**
 * Pick the selected parcel's outer ring (largest polygon) from the WFS
 * FeatureCollection (EPSG:4326) and return it in RD metres. `selected` is
 * `parcel.properties` from useParcel (gemeenteCode / sectie / perceelnummer).
 */
export function selectedParcelRingRd(geojson, selected) {
  if (!selected) return null
  const feature = geojson?.features?.find((f) => {
    const p = f.properties ?? {}
    return (
      p.kadastraleGemeenteCode === selected.gemeenteCode &&
      p.sectie === selected.sectie &&
      p.perceelnummer === selected.perceelnummer
    )
  })
  const parts = polygonParts(feature?.geometry)
  if (!parts.length) return null
  let best = null
  let bestArea = -1
  for (const part of parts) {
    const ring = ringToRd(part.outer)
    const a = rdRingArea(ring)
    if (a > bestArea) {
      bestArea = a
      best = ring
    }
  }
  return best
}

/**
 * Square-ish RD window around the parcel: padded by `pad` metres, at least
 * `minSize` wide, at most `maxSize` (very large parcels are clipped around their
 * centroid to keep the heightfield small).
 */
export function sliceBounds(parcelRing, { pad = 30, minSize = 80, maxSize = 300 } = {}) {
  const [minX, minY, maxX, maxY] = ringBounds(parcelRing)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const half = Math.min(maxSize, Math.max(minSize, maxX - minX + 2 * pad, maxY - minY + 2 * pad)) / 2
  return [cx - half, cy - half, cx + half, cy + half]
}

export { createParcelFrame }
