import { describe, it, expect } from 'vitest'
import {
  wgs84ToRd,
  rdToWgs84,
  latLngToRd,
  rdDistance,
  rdRingArea,
  createParcelFrame,
} from '../rd.js'

describe('rd', () => {
  it('maps the Amersfoort origin (WGS84 ~52.155172N, 5.387206E) to RD(155000, 463000)', () => {
    // Note: proj4's lat_0/lon_0 (52.1561606, 5.3876389) are Bessel coordinates;
    // in WGS84 the same point is ~30 m away.
    const [x, y] = wgs84ToRd([5.387206, 52.155172])
    expect(Math.abs(x - 155000)).toBeLessThan(3)
    expect(Math.abs(y - 463000)).toBeLessThan(3)
  })

  it('round-trips RD -> WGS84 -> RD to the millimetre', () => {
    const [x, y] = wgs84ToRd(rdToWgs84([155000, 463000]))
    expect(x).toBeCloseTo(155000, 3)
    expect(y).toBeCloseTo(463000, 3)
  })

  it('is lon-first and lat/lng helper flips correctly', () => {
    const [lon, lat] = rdToWgs84([155000, 463000])
    expect(lat).toBeCloseTo(52.156, 2)
    expect(lon).toBeCloseTo(5.388, 2)
    expect(latLngToRd(lat, lon)[0]).toBeCloseTo(155000, 3)
  })

  it('computes planar distance and area in metres', () => {
    expect(rdDistance([0, 0], [3, 4])).toBe(5)
    expect(rdRingArea([[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]])).toBe(50)
  })

  it('parcel frame: east +X, north -Z, and fromLocal inverts toLocal', () => {
    const frame = createParcelFrame([[100, 200], [110, 200], [110, 210], [100, 210], [100, 200]])
    expect(frame.centroid).toEqual([105, 205])
    const v = frame.toLocal([107, 208], 4.5)
    expect(v).toEqual({ x: 2, y: 4.5, z: -3 })
    expect(frame.fromLocal(v)).toEqual([107, 208])
  })
})
