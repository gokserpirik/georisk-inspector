<template>
  <div class="search" ref="rootEl">
    <input
      ref="inputEl"
      v-model="query"
      type="text"
      placeholder="Search a Dutch address, place or parcel…"
      aria-label="Search address, place or parcel"
      role="combobox"
      aria-autocomplete="list"
      aria-controls="search-results"
      :aria-expanded="focused && results.length > 0"
      :aria-activedescendant="focused && activeIndex >= 0 ? `search-option-${activeIndex}` : undefined"
      :aria-busy="searching"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.down.prevent="moveActive(1)"
      @keydown.up.prevent="moveActive(-1)"
      @keydown.enter.prevent="onEnter"
      @keydown.escape="closeResults"
    />
    <div v-if="focused && searching" class="search-hint">Searching…</div>
    <div v-else-if="focused && results.length" id="search-results" class="results" role="listbox" aria-label="Search suggestions">
      <div
        v-for="(r, i) in results"
        :key="`${r.id}-${i}`"
        class="result-item"
        :id="`search-option-${i}`"
        role="option"
        :aria-selected="i === activeIndex"
        @mousedown.prevent
        @click="select(r)"
      >
        <span class="result-label">{{ r.label }}</span>
        <span v-if="r.type" class="result-type">{{ r.type }}</span>
      </div>
    </div>
    <div v-else-if="focused && empty" class="search-hint">No matches in the Netherlands.</div>
    <div v-if="error" class="search-error" role="alert">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
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
const activeIndex = ref(-1)
const rootEl = ref(null)
const inputEl = ref(null)

let debounceTimer = null
let aborter = null
let suppressSearch = false

function cancelPending() {
  clearTimeout(debounceTimer)
  aborter?.abort()
  aborter = null
  searching.value = false
}

function closeResults() {
  cancelPending()
  results.value = []
  activeIndex.value = -1
  empty.value = false
}

function moveActive(direction) {
  if (!results.value.length) return
  activeIndex.value = activeIndex.value < 0
    ? (direction > 0 ? 0 : results.value.length - 1)
    : (activeIndex.value + direction + results.value.length) % results.value.length
}

function setQuery(value) {
  suppressSearch = true
  query.value = value
  suppressSearch = false
}

function goTo(lat, lng, q) {
  closeResults()
  router.replace({ path: '/', query: { lat: String(lat), lng: String(lng), q } })
  error.value = ''
}

async function select(place) {
  error.value = ''
  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    setQuery(place.label)
    goTo(place.lat, place.lng, place.label)
    inputEl.value?.blur()
    return
  }
  // Suggestion with an id but no geometry yet: resolve it via lookup.
  cancelPending()
  const current = new AbortController()
  aborter = current
  searching.value = true
  try {
    const resolved = await lookupPlace(place.id, current.signal)
    if (aborter !== current) return
    if (!isInNetherlands(resolved.lat, resolved.lng)) {
      error.value = 'Result is outside the Netherlands — the risk model covers NL only.'
      return
    }
    setQuery(resolved.label)
    goTo(resolved.lat, resolved.lng, resolved.label)
    inputEl.value?.blur()
  } catch (e) {
    if (aborter === current && e?.name !== 'AbortError') error.value = 'Could not resolve that result. Try again.'
  } finally {
    if (aborter === current) { aborter = null; searching.value = false }
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
  if (results.value.length) select(results.value[activeIndex.value < 0 ? 0 : activeIndex.value])
}

watch(query, (val) => {
  if (suppressSearch) return
  cancelPending()
  results.value = []
  activeIndex.value = -1
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
    const current = new AbortController()
    aborter = current
    try {
      const found = await suggestPlaces(val.trim(), current.signal)
      if (aborter !== current) return
      results.value = found
      empty.value = found.length === 0
    } catch (e) {
      if (aborter === current && e?.name !== 'AbortError') {
        error.value = 'Search failed. Try again.'
        results.value = []
      }
    } finally {
      if (aborter === current) { aborter = null; searching.value = false }
    }
  }, 300)
}, { flush: 'sync' })

onUnmounted(cancelPending)

// Search results stagger (transforms only)
useReveal((gsap, scope) => {
  const items = scope?.querySelectorAll('.result-item')
  if (items?.length) gsap.from(items, { y: 8, autoAlpha: 0, duration: 0.3, stagger: 0.05, clearProps: 'all' })
}, rootEl)
</script>
