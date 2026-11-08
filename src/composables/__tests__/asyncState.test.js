import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, nextTick, ref } from 'vue'

vi.mock('../../lib/riskEngine.js', () => ({ calculateParcelMetrics: vi.fn() }))
vi.mock('../../lib/pdok3d.js', () => ({ fetchBuildings: vi.fn(), fetchHeightRaster: vi.fn() }))

import { useParcel } from '../useParcel.js'
import { useParcelMetrics } from '../useParcelMetrics.js'
import { useParcelSlice } from '../useParcelSlice.js'
import { calculateParcelMetrics } from '../../lib/riskEngine.js'
import { fetchBuildings, fetchHeightRaster } from '../../lib/pdok3d.js'
import { rdToWgs84 } from '../../lib/rd.js'

const renderer = createRenderer({
  createElement: () => ({}), insert: () => {}, remove: () => {},
  createText: () => ({}), createComment: () => ({}), setText: () => {},
  setElementText: () => {}, parentNode: () => null, nextSibling: () => null,
  patchProp: () => {},
})
function mount(composable) {
  let result
  const app = renderer.createApp({ setup() { result = composable(); return () => null } })
  app.mount({})
  return { result, unmount: () => app.unmount() }
}
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await nextTick() }
const response = (features, numberMatched) => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features, numberMatched }) })

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('asynchronous parcel state', () => {
  it('invalidates an old parcel request immediately on coordinate change', async () => {
    const old = deferred()
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response([]))
    vi.stubGlobal('fetch', fetchMock)
    const lat = ref(52), lng = ref(4)
    const { result, unmount } = mount(() => useParcel(lat, lng))
    await vi.advanceTimersByTimeAsync(250)
    const oldSignal = fetchMock.mock.calls[0][1].signal
    lat.value = 52.1
    expect(oldSignal.aborted).toBe(true)
    old.resolve(response([]))
    await flush()
    expect(result.data.value).toBeNull()
    await vi.advanceTimersByTimeAsync(250)
    expect(result.data.value?.reason).toBe('no-containing-parcel')
    unmount()
  })

  it('paginates truncated responses and does not select a partial nearest match', async () => {
    const feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[4.0002, 52], [4.0004, 52], [4.0004, 52.0002], [4.0002, 52.0002], [4.0002, 52]]] } }
    const fetchMock = vi.fn().mockResolvedValue(response(Array(25).fill(feature)))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = mount(() => useParcel(ref(52.0001), ref(4.0001)))
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(fetchMock.mock.calls[1][0]).toContain('startIndex=25')
    expect(result.data.value).toMatchObject({ incomplete: true, match: null, reason: 'incomplete-results' })
    unmount()
  })

  it('finds a containing parcel on a later page', async () => {
    const square = (x, id) => ({ type: 'Feature', properties: { kadastraleGemeenteCode: 'A', sectie: 'B', perceelnummer: id, kadastraleGrootteWaarde: 100 }, geometry: { type: 'Polygon', coordinates: [[[x, 52], [x + 0.0002, 52], [x + 0.0002, 52.0002], [x, 52.0002], [x, 52]]] } })
    const fetchMock = vi.fn().mockResolvedValueOnce(response(Array(25).fill(square(4.001, 1)), 26)).mockResolvedValueOnce(response([square(4, 2)], 26))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = mount(() => useParcel(ref(52.0001), ref(4.0001)))
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.data.value).toMatchObject({ match: 'contains', incomplete: false, properties: { perceelnummer: 2 } })
    unmount()
  })

  it('clears and invalidates metrics as soon as the parcel changes', async () => {
    const old = deferred()
    calculateParcelMetrics.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ lat: 52.1 })
    const lat = ref(52), lng = ref(4), parcel = ref({ area: 100 })
    const { result, unmount } = mount(() => useParcelMetrics(lat, lng, parcel))
    await vi.advanceTimersByTimeAsync(300)
    const signal = calculateParcelMetrics.mock.calls[0][2].signal
    parcel.value = null
    lat.value = 52.1
    expect(signal.aborted).toBe(true)
    old.resolve({ lat: 52 })
    await flush()
    expect(result.data.value).toBeNull()
    parcel.value = { area: 200 }
    await vi.advanceTimersByTimeAsync(300)
    expect(result.data.value).toEqual({ lat: 52.1 })
    unmount()
  })

  it('discards an in-flight 3D slice when the parcel disappears', async () => {
    const pending = deferred()
    fetchBuildings.mockReturnValue(pending.promise)
    fetchHeightRaster.mockResolvedValue({ sample: () => 0 })
    const ring = [[155000, 463000], [155020, 463000], [155020, 463020], [155000, 463020], [155000, 463000]].map(rdToWgs84)
    const parcel = ref({ properties: { gemeenteCode: 'A', sectie: 'B', perceelnummer: 1 }, geojson: { features: [{ properties: { kadastraleGemeenteCode: 'A', sectie: 'B', perceelnummer: 1 }, geometry: { type: 'Polygon', coordinates: [ring] } }] } })
    const { result, unmount } = mount(() => useParcelSlice(parcel, ref(true)))
    await vi.dynamicImportSettled()
    await flush()
    expect(fetchBuildings).toHaveBeenCalled()
    const signal = fetchBuildings.mock.calls[0][1]
    parcel.value = null
    expect(signal.aborted).toBe(true)
    pending.resolve([])
    await flush()
    expect(result.slice.value).toBeNull()
    expect(result.loading.value).toBe(false)
    unmount()
  })
})
