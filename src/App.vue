<template>
  <div class="app" ref="rootEl">
    <header class="app-header" ref="headerEl">
      <div class="brand">GeoRisk <span>Inspector</span></div>
      <SearchBar />
    </header>
    <div class="app-body">
      <RiskMap ref="mapEl" :lat="lat" :lng="lng" />
      <MetricsDrawer
        ref="drawerEl"
        :metrics="metricsData"
        :label="label"
        :loading="loading"
        :error="error"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import SearchBar from './components/SearchBar.vue'
import RiskMap from './components/RiskMap.vue'
import MetricsDrawer from './components/MetricsDrawer.vue'
import { useParcelMetrics } from './composables/useParcelMetrics.js'
import { DEFAULT_CENTER } from './lib/location.js'
import { isInNetherlands } from './composables/useGeocoding.js'
import { useReveal } from './composables/useReveal.js'

const route = useRoute()
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

const { data: metricsData, loading, error } = useParcelMetrics(lat, lng)

// Boot timeline: header -> map -> drawer cards stagger (transforms/autoAlpha only)
useReveal((gsap, scope) => {
  const tl = gsap.timeline({ defaults: { clearProps: 'all' } })
  tl.from(scope.querySelector('.app-header'), { y: -16, autoAlpha: 0, duration: 0.5 })
    .from(scope.querySelector('.map-pane'), { autoAlpha: 0, duration: 0.6 }, '-=0.2')
    .from(scope.querySelectorAll('.drawer .card'), { x: 24, autoAlpha: 0, duration: 0.45, stagger: 0.08 }, '-=0.3')
}, rootEl)
</script>
