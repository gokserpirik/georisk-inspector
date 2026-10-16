<template>
  <div class="search" ref="rootEl">
    <input
      ref="inputEl"
      v-model="query"
      type="text"
      placeholder="Search a Dutch address, place or parcel…"
      aria-label="Search address, place or parcel"
      :aria-busy="searching"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.enter="onEnter"
      @keydown.escape="results = []"
    />
    <div v-if="focused && searching" class="search-hint">Searching…</div>
    <div v-else-if="focused && results.length" class="results">
      <div
        v-for="(r, i) in results"
        :key="`${r.id}-${i}`"
        class="result-item"
        @mousedown.prevent
        @click="select(r)"
      >
        <span class="result-label">{{ r.label }}</span>
        <span v-if="r.type" class="result-type">{{ r.type }}</span>
      </div>
    </div>
    <div v-else-if="focused && empty" class="search-hint">No matches in the Netherlands.</div>
    <div v-if="error" class="search-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { parseLatLng, suggestPlaces, lookupPlace, isInNetherlands } from '../composables/useGeocoding.js'
import { useReveal } from '../composables/useReveal.js'

const router = useRouter()
const query = ref('')
const results = ref([])
const error = ref('')
const searching = ref(false)
const empty = ref(false)
const focused = ref(false)
const rootEl = ref(null)
const inputEl = ref(null)

let debounceTimer = null
let aborter = null

function goTo(lat, lng, q) {
  router.replace({ path: '/', query: { lat: String(lat), lng: String(lng), q } })
  results.value = []
  empty.value = false
  error.value = ''
}

async function select(place) {
  error.value = ''
  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    query.value = place.label
    goTo(place.lat, place.lng, place.label)
    inputEl.value?.blur()
    return
  }
  // Suggestion with an id but no geometry yet: resolve it via lookup.
  aborter?.abort()
  aborter = new AbortController()
  searching.value = true
  try {
    const resolved = await lookupPlace(place.id, aborter.signal)
    if (!isInNetherlands(resolved.lat, resolved.lng)) {
      error.value = 'Result is outside the Netherlands — the risk model covers NL only.'
      return
    }
    query.value = resolved.label
    goTo(resolved.lat, resolved.lng, resolved.label)
    inputEl.value?.blur()
  } catch (e) {
    if (e?.name !== 'AbortError') error.value = 'Could not resolve that result. Try again.'
  } finally {
    searching.value = false
  }
}

function onEnter() {
  const parsed = parseLatLng(query.value)
  if (parsed) {
    if (!isInNetherlands(parsed.lat, parsed.lng)) {
      error.value = 'Coordinates are outside the Netherlands — the risk model covers NL only.'
      return
    }
    goTo(parsed.lat, parsed.lng, query.value.trim())
    inputEl.value?.blur()
    return
  }
  if (results.value.length) select(results.value[0])
}

watch(query, (val) => {
  clearTimeout(debounceTimer)
  aborter?.abort()
  error.value = ''
  empty.value = false
  if (!val || val.trim().length < 3) {
    results.value = []
    searching.value = false
    return
  }
  if (parseLatLng(val)) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  debounceTimer = setTimeout(async () => {
    aborter = new AbortController()
    try {
      const found = await suggestPlaces(val.trim(), aborter.signal)
      results.value = found
      empty.value = found.length === 0
    } catch (e) {
      if (e?.name !== 'AbortError') {
        error.value = 'Search failed. Try again.'
        results.value = []
      }
    } finally {
      if (!aborter?.signal.aborted) searching.value = false
    }
  }, 300)
})

// Search results stagger (transforms only)
useReveal((gsap, scope) => {
  const items = scope?.querySelectorAll('.result-item')
  if (items?.length) gsap.from(items, { y: 8, autoAlpha: 0, duration: 0.3, stagger: 0.05, clearProps: 'all' })
}, rootEl)
</script>
