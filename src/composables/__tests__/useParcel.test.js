import { describe, it, expect } from 'vitest'
import { pickParcel } from '../useParcel.js'

/**
 * Geometry helpers for the fixture parcels. Coordinates are [lng, lat].
 * A default square spans 0.0002° (~13.7 m E-W at 52°N, ~22 m N-S).
 */
const polygon = (ox, oy, side = 0.0002) => ({
  type: 'Feature',
  properties: { id: `${ox},${oy}` },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [ox, oy],
        [ox + side, oy],
        [ox + side, oy + side],
        [ox, oy + side],
        [ox, oy],
      ],
    ],
  },
})

// Two disjoint squares in one MultiPolygon: a small one and a larger one.
const multiPolygon = () => ({
  type: 'Feature',
  properties: { id: 'multi' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [5.0, 53.0],
          [5.00005, 53.0],
          [5.00005, 53.00005],
          [5.0, 53.00005],
          [5.0, 53.0],
        ],
      ],
      [
        [
          [5.001, 53.0],
          [5.0014, 53.0],
          [5.0014, 53.0004],
          [5.001, 53.0004],
          [5.001, 53.0],
        ],
      ],
    ],
  },
})

const SQUARE = polygon(4.0, 52.0) // lng 4.0000..4.0002, lat 52.0000..52.0002

describe('pickParcel', () => {
  it('returns the containing parcel for a point inside a Polygon', () => {
    const picked = pickParcel([SQUARE], 52.0001, 4.0001)
    expect(picked?.match).toBe('contains')
    expect(picked?.feature).toBe(SQUARE)
  })

  it('treats a point on a shared boundary as inside (ignoreBoundary is false)', () => {
    const picked = pickParcel([SQUARE], 52.0001, 4.0)
    expect(picked?.match).toBe('contains')
  })

  it('falls back to the nearest parcel centroid when the click is just outside', () => {
    // ~3.4 m east of the east edge; the centroid sits ~10 m to the west.
    const picked = pickParcel([SQUARE], 52.0001, 4.0002 + 0.00005)
    expect(picked?.match).toBe('nearest-centroid')
    expect(picked?.feature).toBe(SQUARE)
    expect(picked?.distanceM).toBeGreaterThan(0)
    expect(picked?.distanceM).toBeLessThanOrEqual(50)
  })

  it('returns null when the nearest parcel is beyond the 50 m radius', () => {
    expect(pickParcel([SQUARE], 52.0, 4.05)).toBeNull()
  })

  it('returns null for an empty FeatureCollection', () => {
    expect(pickParcel([], 52.0001, 4.0001)).toBeNull()
    expect(pickParcel(undefined, 52.0001, 4.0001)).toBeNull()
  })

  it('handles MultiPolygon containment', () => {
    const picked = pickParcel([multiPolygon()], 53.0002, 5.0012)
    expect(picked?.match).toBe('contains')
  })

  it('returns null when a MultiPolygon does not contain the point and is far away', () => {
    expect(pickParcel([multiPolygon()], 53.0002, 5.002)).toBeNull()
  })

  it('prefers the exact containing parcel over a nearer centroid', () => {
    // Points inside SQUARE, with a second parcel whose centroid is close by.
    const neighbour = polygon(4.0003, 52.0)
    const picked = pickParcel([neighbour, SQUARE], 52.0001, 4.0001)
    expect(picked?.match).toBe('contains')
    expect(picked?.feature).toBe(SQUARE)
  })
})
