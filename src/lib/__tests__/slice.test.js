import { describe, it, expect } from 'vitest'
import {
  pointInRing,
  createRaster,
  buildingHeights,
  buildBuildings,
  sliceBounds,
  selectedParcelRingRd,
  DEFAULT_BUILDING_HEIGHT,
} from '../slice.js'
import { rdToWgs84 } from '../rd.js'

// 10x10 m raster at 1 m/px, origin (0,0)-(10,10), constant value (or custom).
const flat = (v) => createRaster({ width: 10, height: 10, bbox: [0, 0, 10, 10], data: new Float32Array(100).fill(v) })
const square = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]

describe('slice', () => {
  it('pointInRing works on closed rings', () => {
    expect(pointInRing(5, 5, square)).toBe(true)
    expect(pointInRing(9, 9, square)).toBe(false)
  })

  it('raster samples bilinearly and treats row 0 as north', () => {
    const data = new Float32Array(100)
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) data[r * 10 + c] = r // value = row index
    const r = createRaster({ width: 10, height: 10, bbox: [0, 0, 10, 10], data })
    expect(r.sample(5, 9.5)).toBeCloseTo(0, 5) // northernmost row
    expect(r.sample(5, 0.5)).toBeCloseTo(9, 5) // southernmost row
    expect(r.sample(5, 5)).toBeCloseTo(4.5, 5)
  })

  it('skips nodata and returns null when nothing is valid', () => {
    const data = new Float32Array(100).fill(NaN)
    data[55] = 3
    const r = createRaster({ width: 10, height: 10, bbox: [0, 0, 10, 10], data })
    expect(r.sample(5.5, 4.5)).toBe(3)
    expect(createRaster({ width: 10, height: 10, bbox: [0, 0, 10, 10], data: new Float32Array(100).fill(3.4e38) }).sample(5, 5)).toBeNull()
  })

  it('rejects out-of-bounds samples while preserving interpolation at raster edges', () => {
    const r = flat(3)
    expect(r.sample(-0.01, 5)).toBeNull()
    expect(r.sample(10.01, 5)).toBeNull()
    expect(r.sample(5, 10.01)).toBeNull()
    expect(r.sample(5, -0.01)).toBeNull()
    expect(r.sample(0, 10)).toBe(3)
  })

  it('does not fabricate heights for buildings wholly outside the raster', () => {
    const outside = [[11, 2], [15, 2], [15, 6], [11, 6], [11, 2]]
    expect(buildingHeights(outside, flat(10), flat(2)).height).toBeNull()
    const crossing = [[8, 2], [12, 2], [12, 6], [8, 6], [8, 2]]
    expect(buildingHeights(crossing, flat(10), flat(2)).height).toBe(8)
  })

  it('derives building heights from DSM − DTM', () => {
    const h = buildingHeights(square, flat(11), flat(1))
    expect(h.groundNap).toBeCloseTo(1, 5)
    expect(h.height).toBeCloseTo(10, 5)
    expect(h.roofNap).toBeCloseTo(11, 5)
    expect(h.baseNap).toBeLessThan(1)
    expect(h.coverage).toBe(1)
  })

  it('flags partial raster coverage and excludes building courtyards', () => {
    const crossing = [[8, 2], [12, 2], [12, 6], [8, 6], [8, 2]]
    const [building] = buildBuildings([{ geometry: { type: 'Polygon', coordinates: [crossing] } }], flat(10), flat(2), 0)
    expect(building.height).toBe(8)
    expect(building.coverage).toBeGreaterThan(0)
    expect(building.coverage).toBeLessThan(1)
    expect(building.estimated).toBe(true)

    const hole = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]
    const dsm = { sample: (x, y) => pointInRing(x, y, hole) ? 100 : 10 }
    expect(buildingHeights(square, dsm, flat(2), [hole]).height).toBe(8)
  })

  it('flags buildings without data as estimated with a default height', () => {
    const nodata = createRaster({ width: 10, height: 10, bbox: [0, 0, 10, 10], data: new Float32Array(100).fill(NaN) })
    const [b] = buildBuildings(
      [{ id: 'x', properties: { identificatie: '1' }, geometry: { type: 'Polygon', coordinates: [square] } }],
      nodata,
      nodata,
      -2,
    )
    expect(b.estimated).toBe(true)
    expect(b.groundNap).toBe(-2)
    expect(b.height).toBe(DEFAULT_BUILDING_HEIGHT)
  })

  it('slice bounds are padded, clamped and centred', () => {
    const [a, b, c, d] = sliceBounds(square)
    expect([(a + c) / 2, (b + d) / 2]).toEqual([5, 5])
    expect(c - a).toBe(80) // 6 m parcel + padding < minSize
    const big = sliceBounds([[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]])
    expect(big[2] - big[0]).toBe(300)
  })

  it('selects the matching parcel and returns it in RD metres', () => {
    const ll = (xy) => rdToWgs84(xy)
    const ring = [[155000, 463000], [155020, 463000], [155020, 463020], [155000, 463020], [155000, 463000]].map(ll)
    const geojson = {
      features: [
        { properties: { kadastraleGemeenteCode: 'A', sectie: 'B', perceelnummer: 1 }, geometry: { type: 'Polygon', coordinates: [ring] } },
        { properties: { kadastraleGemeenteCode: 'A', sectie: 'B', perceelnummer: 2 }, geometry: { type: 'Polygon', coordinates: [ring.slice(0, 4).concat([ring[0]])] } },
      ],
    }
    const rd = selectedParcelRingRd(geojson, { gemeenteCode: 'A', sectie: 'B', perceelnummer: 1 })
    expect(rd[0][0]).toBeCloseTo(155000, 2)
    expect(rd[2][1]).toBeCloseTo(463020, 2)
    expect(selectedParcelRingRd(geojson, { gemeenteCode: 'Z', sectie: 'B', perceelnummer: 1 })).toBeNull()
  })
})
