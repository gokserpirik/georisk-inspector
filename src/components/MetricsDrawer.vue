<template>
  <aside class="drawer" ref="rootEl">
    <div v-if="loading && !metrics" class="card drawer-card">
      <h3>Parcel</h3>
      <div class="coords loading-state">Calculating physical risk model…</div>
    </div>

    <div v-else-if="error && !metrics" class="card drawer-card">
      <h3>Parcel</h3>
      <div class="coords error-state">{{ error }}</div>
    </div>

    <template v-else-if="metrics">
      <div class="card drawer-card">
        <h3>Parcel</h3>
        <div class="metric-row">
          <span class="label">Risk band</span>
          <span class="badge" :class="metrics.riskBand" ref="badgeEl">{{ metrics.riskBand }}</span>
        </div>
        <div class="coords">{{ metrics.lat.toFixed(5) }}, {{ metrics.lng.toFixed(5) }}</div>
        <div v-if="label" class="coords">{{ label }}</div>
      </div>

      <div class="card drawer-card">
        <h3>Valuation &amp; Elevation</h3>
        <div class="metric-row">
          <span class="label">Estimate</span>
          <span class="value">€{{ animatedValuation }}</span>
        </div>
        <div class="metric-row">
          <span class="label">Elevation</span>
          <span class="value" :title="metrics.elevationSource ? `Source: ${metrics.elevationSource}` : ''">
            {{ metrics.elevation.toFixed(1) }} m
            <span v-if="metrics.isMockElevation" class="badge mock" title="Live PDOK lookup failed — showing mock elevation">mock data</span>
          </span>
        </div>
      </div>

      <div class="card drawer-card">
        <h3>Risk scores</h3>
        <div v-for="item in riskItems" :key="item.key" class="risk-bar">
          <div class="bar-head">
            <span>{{ item.label }}</span>
            <strong>{{ item.score }}/100</strong>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill risk-fill"
              :data-risk="item.key"
              :style="{ background: item.color, transform: `scaleX(${item.score / 100})` }"
            ></div>
          </div>
        </div>
        <div class="metric-row">
          <span class="label">Overall</span>
          <span class="value">{{ metrics.overall }}/100</span>
        </div>
      </div>

      <RiskChart :risks="metrics.risks" :depreciation="metrics.depreciation" :key="metricsKey" />
    </template>
  </aside>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import RiskChart from './RiskChart.vue'
import { gsap } from '../lib/gsap.js'
import { useReveal } from '../composables/useReveal.js'

const props = defineProps({
  metrics: { type: Object, default: null },
  label: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const rootEl = ref(null)
const badgeEl = ref(null)
const animatedValuation = ref('—')

const metricsKey = computed(() =>
  props.metrics ? `${props.metrics.lat.toFixed(5)},${props.metrics.lng.toFixed(5)}` : 'empty',
)

const riskItems = computed(() => [
  // Flood inherits elevation uncertainty: mark estimate when elevation is mock
  { key: 'flood', label: props.metrics.isMockElevation ? 'Flood (estimate)' : 'Flood', score: props.metrics.risks.flood, color: '#e63946' },
  { key: 'subsidence', label: 'Subsidence (estimate)', score: props.metrics.risks.subsidence, color: '#e9a13b' },
  { key: 'fire', label: 'Fire (estimate)', score: props.metrics.risks.fire, color: '#0071e3' },
])

function countUp(to) {
  const from = Number(String(animatedValuation.value).replace(/[^0-9]/g, '')) || 0
  const obj = { v: from }
  gsap.to(obj, {
    v: to,
    duration: 0.6,
    snap: { v: 1000 },
    onUpdate: () => {
      animatedValuation.value = Math.round(obj.v).toLocaleString('en-US')
    },
    clearProps: 'all',
  })
}

function animateBars() {
  nextTick(() => {
    const fills = rootEl.value?.querySelectorAll('.risk-fill')
    if (fills?.length && props.metrics)
      gsap.fromTo(fills, { scaleX: 0 }, { scaleX: (i, el) => Number(el.dataset.risk ? props.metrics.risks[el.dataset.risk] / 100 : 1), duration: 0.6, stagger: 0.08, clearProps: 'transform' })
  })
}

function pulseBadge() {
  if (props.metrics?.riskBand !== 'high' || !badgeEl.value) return
  gsap.fromTo(badgeEl.value, { scale: 1 }, { scale: 1.12, duration: 0.35, yoyo: true, repeat: 1, clearProps: 'transform' })
}

function refreshDrawer(m) {
  if (!m) return
  countUp(m.valuation)
  animateBars()
  nextTick(() => {
    const cards = rootEl.value?.querySelectorAll('.drawer-card')
    if (cards?.length) gsap.from(cards, { x: 16, autoAlpha: 0, duration: 0.4, stagger: 0.07, clearProps: 'all' })
    pulseBadge()
  })
}

// Drawer refresh on parcel change: count-up + bars + badge
watch(() => props.metrics, refreshDrawer)

// Initial entrance is covered by the App boot timeline; bars still animate in
useReveal(() => {
  if (props.metrics) refreshDrawer(props.metrics)
}, rootEl)
</script>
