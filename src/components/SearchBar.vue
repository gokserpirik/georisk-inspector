<template>
  <div class="search" ref="rootEl">
    <input
      v-model="query"
      type="text"
      placeholder="Search a Dutch address or paste lat,lng…"
      aria-label="Search address or coordinates"
      @keydown.enter="onEnter"
      @keydown.escape="results = []"
    />
    <div v-if="results.length" class="results">
      <div
        v-for="(r, i) in results"
        :key="`${r.lat},${r.lng},${i}`"
        class="result-item"
        @click="select(r)"
      >
        {{ r.label }}
      </div>
    </div>
    <div v-if="error" class="search-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { parseLatLng, searchPlaces, isInNetherlands } from '../composables/useGeocoding.js'
import { useReveal } from '../composables/useReveal.js'

const router = useRouter()
const query = ref('')
const results = ref([])
const error = ref('')
const rootEl = ref(null)

let debounceTimer = null
let aborter = null

function goTo(lat, lng, q) {
  router.replace({ path: '/', query: { lat: String(lat), lng: String(lng), q } })
  results.value = []
  error.value = ''
}

function select(place) {
  query.value = place.label
  goTo(place.lat, place.lng, place.label)
}

function onEnter() {
  const parsed = parseLatLng(query.value)
  if (parsed) {
    if (!isInNetherlands(parsed.lat, parsed.lng)) {
      error.value = 'Coordinates are outside the Netherlands — the risk model covers NL only.'
      return
    }
    goTo(parsed.lat, parsed.lng, query.value.trim())
    return
  }
  if (results.value.length) select(results.value[0])
}

watch(query, (val) => {
  clearTimeout(debounceTimer)
  aborter?.abort()
  error.value = ''
  if (!val || val.trim().length < 3) {
    results.value = []
    return
  }
  if (parseLatLng(val)) {
    results.value = []
    return
  }
  debounceTimer = setTimeout(async () => {
    aborter = new AbortController()
    try {
      results.value = await searchPlaces(val.trim(), aborter.signal)
    } catch (e) {
      if (e.name !== 'AbortError') error.value = 'Search failed. Try again.'
    }
  }, 400)
})

// Search results stagger (transforms only)
useReveal((gsap, scope) => {
  const items = scope?.querySelectorAll('.result-item')
  if (items?.length) gsap.from(items, { y: 8, autoAlpha: 0, duration: 0.3, stagger: 0.05, clearProps: 'all' })
}, rootEl)
</script>
