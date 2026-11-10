<template>
  <div class="app" ref="rootEl">
    <header class="app-header" ref="headerEl">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span>GeoRisk <span>Inspector</span></div>
      <div class="header-context">Dutch parcel workspace <span aria-hidden="true">/</span> <strong>{{ label || 'Selected location' }}</strong></div>
      <button type="button" class="header-action" @click="shareLocation">{{ copied ? 'Link copied' : 'Share view' }}</button>
      <button
        type="button"
        class="btn-3d"
        :class="{ active: show3d }"
        :aria-pressed="show3d"
        :disabled="!show3d && (!parcelData?.properties || isFallback)"
        @click="toggle3d"
      >
        3D slice
      </button>
    </header>
    <div class="app-body" :class="`view-${mobileView}`">
      <section class="inspector-panel" aria-label="Parcel inspection">
        <div class="panel-intro">
          <div class="panel-title-row"><h1>Parcel inspector</h1><span class="panel-region">Netherlands</span></div>
          <p>Explore a location and inspect its cadastral and terrain context.</p>
          <SearchBar />
        </div>
        <MetricsDrawer
          ref="drawerEl"
          :metrics="metricsData"
          :parcel="parcelData"
          :is-fallback="isFallback"
          :label="label"
          :loading="loading"
          :error="error"
        />
        <div class="panel-footer"><span class="status-dot" :class="{ degraded: isFallback }" aria-hidden="true"></span> {{ isFallback ? 'Parcel data unavailable' : 'PDOK data where available' }} <span>·</span> Prototype risk model</div>
      </section>
      <RiskMap
        ref="mapEl"
        :lat="lat"
        :lng="lng"
        :parcel="parcelData"
        :is-fallback="isFallback"
        :active="mobileView === 'map'"
        @select="onSelect"
      />
      <ParcelSlice3D
        v-if="show3d"
        :slice="slice"
        :loading="sliceLoading"
        :error="sliceError"
        @close="toggle3d"
      />
    </div>
    <nav class="mobile-switch" aria-label="Inspector views">
      <button type="button" :class="{ active: mobileView === 'list' }" :aria-current="mobileView === 'list' ? 'page' : undefined" @click="mobileView = 'list'">List</button>
      <button type="button" :class="{ active: mobileView === 'map' }" :aria-current="mobileView === 'map' ? 'page' : undefined" @click="mobileView = 'map'">Map</button>
    </nav>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SearchBar from './components/SearchBar.vue'
import MetricsDrawer from './components/MetricsDrawer.vue'
import { useParcel } from './composables/useParcel.js'
import { useParcelSlice } from './composables/useParcelSlice.js'
import { useParcelMetrics } from './composables/useParcelMetrics.js'
import { DEFAULT_CENTER } from './lib/location.js'
import { isInNetherlands } from './composables/useGeocoding.js'
import { useReveal } from './composables/useReveal.js'

const ParcelSlice3D = defineAsyncComponent(() => import('./components/ParcelSlice3D.vue'))
const RiskMap = defineAsyncComponent(() => import('./components/RiskMap.vue'))

const route = useRoute()
const router = useRouter()
const rootEl = ref(null)
const mobileView = ref('list')
const copied = ref(false)
let copyTimer
onUnmounted(() => clearTimeout(copyTimer))

async function shareLocation() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard access can be unavailable in non-secure contexts.
    copied.value = false
  }
}

const lat = computed(() => {
  const v = Number(route.query.lat)
  const lngV = Number(route.query.lng)
  // Risk model covers NL only: out-of-bounds URL coords fall back to default
  if (!Number.isFinite(v) || !Number.isFinite(lngV) || !isInNetherlands(v, lngV)) return DEFAULT_CENTER.lat
  return v
})
const lng = computed(() => {
  const v = Number(route.query.lng)
  const latV = Number(route.query.lat)
  if (!Number.isFinite(v) || !Number.isFinite(latV) || !isInNetherlands(latV, v)) return DEFAULT_CENTER.lng
  return v
})
const label = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))

// Live cadastral parcel (PDOK Kadaster WFS v5) — the URL query is the single
// source of truth, so a map click or search simply rewrites it.
const { data: parcelData } = useParcel(lat, lng)
const { data: metricsData, error } = useParcelMetrics(lat, lng, parcelData)

const isFallback = computed(() => parcelData.value?.isFallback ?? false)
// Skeleton until the first metrics land (covers parcel fetch + scoring).
const loading = computed(() => !metricsData.value && !error.value)

// 3D slice: URL-driven (`view=3d`) like the rest of the state. three.js is only
// downloaded when the view is first opened.
const show3d = computed(() => route.query.view === '3d')
const { slice, loading: sliceLoading, error: sliceError } = useParcelSlice(parcelData, show3d)

function toggle3d() {
  const query = { ...route.query }
  if (show3d.value) delete query.view
  else query.view = '3d'
  router.replace({ path: '/', query })
}

function onSelect(point) {
  if (!point) return
  const query = { lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) }
  if (show3d.value) query.view = '3d'
  router.replace({ path: '/', query })
  mobileView.value = 'list'
}

// Boot timeline: header -> map -> drawer cards stagger (transforms/autoAlpha only).
// Each target is guarded so an empty drawer (metrics not yet loaded) can't emit
// "GSAP target not found" warnings.
useReveal((gsap, scope) => {
  if (!scope) return
  const header = scope.querySelector('.app-header')
  const map = scope.querySelector('.map-pane')
  const cards = scope.querySelectorAll('.drawer .card')
  const tl = gsap.timeline({ defaults: { clearProps: 'all' } })
  if (header) tl.from(header, { y: -16, autoAlpha: 0, duration: 0.5 })
  if (map) tl.from(map, { autoAlpha: 0, duration: 0.6 }, '-=0.2')
  if (cards.length) tl.from(cards, { x: 24, autoAlpha: 0, duration: 0.45, stagger: 0.08 }, '-=0.3')
}, rootEl)
</script>
