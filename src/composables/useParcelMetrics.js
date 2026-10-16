import { ref, watch, unref, onUnmounted } from 'vue'
import { calculateParcelMetrics } from '../lib/riskEngine.js'

function debounce(fn, delay) {
  let timeoutId
  const wrapped = (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
  wrapped.cancel = () => clearTimeout(timeoutId)
  return wrapped
}

/**
 * Reactive parcel metrics: debounced fetch, AbortController cancels stale
 * requests so rapid map clicks can't overwrite fresh data with old results.
 *
 * `parcelRef` carries the resolved cadastral parcel ({ area, properties,
 * isFallback }) from useParcel. Metrics wait for it so the area factor uses
 * live PDOK geometry rather than a cold-start heuristic.
 */
export function useParcelMetrics(latRef, lngRef, parcelRef = null) {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)
  let currentController = null

  const fetchMetrics = async (lat, lng, parcel) => {
    if (lat == null || lng == null) return
    if (currentController) currentController.abort()
    const controller = new AbortController()
    currentController = controller
    loading.value = true
    error.value = null
    try {
      const result = await calculateParcelMetrics(lat, lng, { signal: controller.signal, parcel })
      if (currentController !== controller) return // superseded, ignore
      data.value = result
    } catch (err) {
      if (err?.name === 'AbortError') return
      if (currentController !== controller) return
      error.value = err?.message || 'Failed to fetch parcel metrics'
      data.value = null
    } finally {
      if (currentController === controller) loading.value = false
    }
  }

  const debouncedFetch = debounce(fetchMetrics, 300)

  const stopWatch = watch(
    [() => unref(latRef), () => unref(lngRef), () => (parcelRef ? unref(parcelRef) : null)],
    ([newLat, newLng, parcel]) => {
      // Wait for the parcel (live or fallback) before scoring, so the area
      // factor and its source label are accurate on the first render.
      if (!parcel) return
      debouncedFetch(newLat, newLng, parcel)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatch()
    debouncedFetch.cancel()
    if (currentController) currentController.abort()
  })

  return { data, loading, error }
}
