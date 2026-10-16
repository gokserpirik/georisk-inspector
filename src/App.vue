<template>
  <div class="app" ref="rootEl">
    <header class="app-header" ref="headerEl">
      <div class="brand">GeoRisk <span>Inspector</span></div>
      <SearchBar />
    </header>
    <div class="app-body">
      <RiskMap
        ref="mapEl"
        :lat="lat"
        :lng="lng"
        :parcel="parcelData"
        :is-fallback="isFallback"
        @select="onSelect"
      />
      <MetricsDrawer
        ref="drawerEl"
        :metrics="metricsData"
        :parcel="parcelData"
        :is-fallback="isFallback"
        :label="label"
        :loading="loading"
        :error="error"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SearchBar from './components/SearchBar.vue'
import RiskMap from './components/RiskMap.vue'
import MetricsDrawer from './components/MetricsDrawer.vue'
import { useParcel } from './composables/useParcel.js'
import { useParcelMetrics } from './composables/useParcelMetrics.js'
import { DEFAULT_CENTER } from './lib/location.js'
import { isInNetherlands } from './composables/useGeocoding.js'
import { useReveal } from './composables/useReveal.js'

const route = useRoute()
const router = useRouter()
const rootEl = ref(null)

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

function onSelect(point) {
  if (!point) return
  router.replace({
    path: '/',
    query: { lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) },
  })
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
