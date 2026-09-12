import { ref, watch, unref, onUnmounted } from 'vue'
import { calculateParcelMetrics } from '../lib/riskEngine.js'

function debounce(fn, delay) {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Reactive parcel metrics: debounced fetch, AbortController cancels stale
 * requests so rapid map clicks can't overwrite fresh data with old results.
 */
export function useParcelMetrics(latRef, lngRef) {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)
  let currentController = null

  const fetchMetrics = async (lat, lng) => {
    if (lat == null || lng == null) return
    if (currentController) currentController.abort()
    const controller = new AbortController()
    currentController = controller
    loading.value = true
    error.value = null
    try {
      const result = await calculateParcelMetrics(lat, lng, controller.signal)
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
    [() => unref(latRef), () => unref(lngRef)],
    ([newLat, newLng]) => debouncedFetch(newLat, newLng),
    { immediate: true },
  )

  onUnmounted(() => {
    stopWatch()
    if (currentController) currentController.abort()
  })

  return { data, loading, error }
}
