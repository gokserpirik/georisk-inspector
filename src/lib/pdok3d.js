import { fromArrayBuffer } from 'geotiff'
import { createRaster } from './slice.js'

// PDOK open data, keyless + CORS. Both services were verified against the live
// GetCapabilities: BAG WFS exposes `bag:pand` (default CRS EPSG:28992, no height
// attributes); AHN WCS exposes `dsm_05m` / `dtm_05m` coverages (NAP metres).
const BAG_WFS = 'https://service.pdok.nl/lv/bag/wfs/v2_0'
const AHN_WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'
const AHN_NATIVE_RES_M = 0.5
const MAX_RASTER_PX = 180

const fmt = (n) => Number(n.toFixed(2))

export function buildBagUrl([minX, minY, maxX, maxY], count = 300) {
  return (
    `${BAG_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=bag:pand` +
    '&outputFormat=application/json&srsName=EPSG:28992' +
    `&bbox=${fmt(minX)},${fmt(minY)},${fmt(maxX)},${fmt(maxY)},urn:ogc:def:crs:EPSG::28992` +
    `&count=${count}`
  )
}

export function buildCoverageUrl(coverageId, [minX, minY, maxX, maxY]) {
  const nativePx = Math.max(maxX - minX, maxY - minY) / AHN_NATIVE_RES_M
  const scale = Math.min(1, MAX_RASTER_PX / nativePx)
  return (
    `${AHN_WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${coverageId}` +
    '&format=image/tiff' +
    `&subset=x(${fmt(minX)},${fmt(maxX)})&subset=y(${fmt(minY)},${fmt(maxY)})` +
    `&scalefactor=${scale.toFixed(4)}`
  )
}

/** BAG building footprints (RD metres) intersecting an RD bbox. */
export async function fetchBuildings(bbox, signal) {
  const res = await fetch(buildBagUrl(bbox), { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`BAG WFS ${res.status}`)
  const json = await res.json()
  return json?.features ?? []
}

/** AHN height raster (NAP metres) for an RD bbox, as a sampleable georeferenced raster. */
export async function fetchHeightRaster(coverageId, bbox, signal) {
  const res = await fetch(buildCoverageUrl(coverageId, bbox), { signal })
  if (!res.ok) throw new Error(`AHN WCS ${coverageId} ${res.status}`)
  const tiff = await fromArrayBuffer(await res.arrayBuffer())
  const image = await tiff.getImage()
  const [data] = await image.readRasters({ interleave: false })
  const nodata = image.getGDALNoData()
  const clean = nodata == null ? data : Float32Array.from(data, (v) => (v === nodata ? NaN : v))
  return createRaster({
    width: image.getWidth(),
    height: image.getHeight(),
    bbox: image.getBoundingBox(),
    data: clean,
  })
}
