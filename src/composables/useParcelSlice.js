import { ref, shallowRef, watch, unref, onUnmounted } from 'vue'
import { buildBuildings, createParcelFrame, selectedParcelRingRd, sliceBounds } from '../lib/slice.js'

/**
 * Load everything the 3D parcel slice needs (BAG footprints + AHN DTM/DSM) for
 * the selected parcel. Only fetches while `enabledRef` is true, so the heavy
 * rasters are never requested unless the user opens the 3D view.
 * `slice` is a shallowRef: rasters hold typed arrays and must stay non-reactive.
 */
export function useParcelSlice(parcelRef, enabledRef) {
  const slice = shallowRef(null)
  const loading = ref(false)
  const error = ref(null)
  let controller = null

  async function load(parcel) {
    if (controller) controller.abort()
    const current = new AbortController()
    controller = current
    slice.value = null
    error.value = null

    const ring = selectedParcelRingRd(parcel?.geojson, parcel?.properties)
    if (!ring) {
      error.value = 'No cadastral parcel selected — click on a parcel to open its 3D slice.'
      return
    }
    loading.value = true
    try {
      const bbox = sliceBounds(ring)
      // Lazy: geotiff is large and only needed once the 3D view is opened.
      const { fetchBuildings, fetchHeightRaster } = await import('../lib/pdok3d.js')
      if (controller !== current) return
      const [features, dtm, dsm] = await Promise.all([
        fetchBuildings(bbox, current.signal),
        fetchHeightRaster('dtm_05m', bbox, current.signal),
        fetchHeightRaster('dsm_05m', bbox, current.signal),
      ])
      if (controller !== current) return
      const frame = createParcelFrame(ring)
      const centreGround = dtm.sample(frame.centroid[0], frame.centroid[1])
      slice.value = {
        parcelId: parcel.properties?.id ?? null,
        ring,
        bbox,
        frame,
        dtm,
        centreGround,
        buildings: buildBuildings(features, dsm, dtm, centreGround ?? 0),
      }
    } catch (err) {
      if (err?.name === 'AbortError' || controller !== current) return
      error.value = err?.message || 'Failed to load 3D slice data'
    } finally {
      if (controller === current) loading.value = false
    }
  }

  const stop = watch(
    [() => unref(parcelRef), () => unref(enabledRef)],
    ([parcel, enabled]) => {
      controller?.abort()
      controller = null
      slice.value = null
      error.value = null
      loading.value = false
      if (!enabled) {
        return
      }
      if (parcel && !parcel.isFallback) load(parcel)
      else if (parcel) error.value = 'Parcel data unavailable — cannot build the 3D slice.'
    },
    { immediate: true, flush: 'sync' },
  )

  onUnmounted(() => {
    stop()
    if (controller) controller.abort()
  })

  return { slice, loading, error }
}
