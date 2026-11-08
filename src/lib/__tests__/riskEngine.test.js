import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateParcelMetrics, extractElevationValue } from '../riskEngine.js'

afterEach(() => vi.unstubAllGlobals())

describe('PDOK elevation parsing', () => {
  it('does not interpret missing or empty values as zero', () => {
    expect(extractElevationValue({ features: [{ properties: {} }] })).toBeNull()
    expect(extractElevationValue({ features: [{ properties: { value: '', BAND1: null, other: '  ' } }] })).toBeNull()
    expect(extractElevationValue({ features: [{ properties: { value_list: ',12' } }] })).toBeNull()
  })

  it('accepts actual zero and other numeric elevations', () => {
    expect(extractElevationValue({ features: [{ properties: { value: 0 } }] })).toBe(0)
    expect(extractElevationValue({ features: [{ properties: { GRAY_INDEX: '-1.5' } }] })).toBe(-1.5)
  })

  it('chooses the sample nearest the requested RD point and ignores unrelated numeric properties', () => {
    const feature = (x, y, value) => ({ geometry: { type: 'Point', coordinates: [x, y] }, properties: { value_list: value } })
    expect(extractElevationValue({ features: [feature(0, 0, '3'), feature(5, 5, '-2')] }, [5, 5])).toBe(-2)
    expect(extractElevationValue({ features: [{ properties: { id: 123 } }] })).toBeNull()
  })
})

describe('risk model availability', () => {
  it('scores using the original elevation rather than its rounded display value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ features: [{ properties: { value_list: '-0.03' } }] }) }))
    const metrics = await calculateParcelMetrics(52, 4)
    expect(metrics.elevation).toBe(-0.03)
    expect(metrics.subsidence).toBe(70)
  })

  it('withholds the overall and elevation-dependent scores when AHN fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const metrics = await calculateParcelMetrics(52, 4, { parcel: { area: 100 } })
    expect(metrics).toMatchObject({ elevation: null, flood: null, subsidence: null, overall: null, riskBand: 'unavailable', fire: 30 })
    expect(metrics.breakdown.find((f) => f.id === 'flood').subScore).toBeNull()
  })
})
