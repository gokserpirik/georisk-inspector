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
        <div class="coords">WGS84 (Lat, Lng) {{ metrics.lat?.toFixed(5) }}, {{ metrics.lng?.toFixed(5) }}</div>
        <div v-if="metrics.rd" class="coords">
          RD New (EPSG:28992) X {{ metrics.rd.x }}, Y {{ metrics.rd.y }} m
        </div>
        <div v-if="label" class="coords">{{ label }}</div>
        <div v-if="isFallback" class="badge mock" title="Live PDOK parcel lookup unavailable">offline / fallback</div>
      </div>

      <div class="card drawer-card">
        <h3>Cadastral parcel</h3>
        <template v-if="cadastre">
          <div class="metric-row">
            <span class="label">Municipality</span>
            <span class="value value-inline">{{ cadastre.gemeente || '—' }}</span>
          </div>
          <div class="metric-row">
            <span class="label">Section / number</span>
            <span class="value value-inline">{{ cadastre.sectie || '—' }} · {{ cadastre.perceelnummer ?? '—' }}</span>
          </div>
          <div class="metric-row">
            <span class="label">Parcel area</span>
            <span class="value value-inline">
              {{ cadastre.area != null ? `${Math.round(cadastre.area).toLocaleString('en-US')} m²` : '—' }}
            </span>
          </div>
          <div v-if="parcel?.match === 'nearest-centroid'" class="coords">
            nearest parcel — click landed on a boundary{{ parcel?.distanceM ? ` (${parcel.distanceM} m)` : '' }}
          </div>
        </template>
        <div v-else class="coords">No cadastral parcel at this point (road, water or outside NL).</div>
      </div>

      <div class="card drawer-card">
        <h3>Valuation &amp; Elevation</h3>
        <div class="metric-row">
          <span class="label">Estimate</span>
          <span class="value">€{{ animatedValuation }}</span>
        </div>
        <div class="metric-row">
          <span class="label">Elevation (NAP)</span>
          <span class="value" :title="metrics.elevationSource ? `Source: ${metrics.elevationSource}` : ''">
            {{ Number(metrics.elevation ?? 0).toFixed(1) }} m NAP
            <span v-if="metrics.isMockElevation" class="badge mock" title="Live PDOK lookup failed — showing mock elevation">mock data</span>
          </span>
        </div>
      </div>

      <div class="card drawer-card">
        <h3>Heuristic Risk Index (Prototype)</h3>
        <div v-for="item in riskItems" :key="item.id" class="risk-bar">
          <div class="bar-head">
            <span>{{ item.label }}</span>
            <strong>{{ item.subScore }}/100</strong>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill risk-fill"
              :data-risk="item.id"
              :style="{ background: item.color, transform: `scaleX(${item.subScore / 100})` }"
            ></div>
          </div>
        </div>
        <div class="metric-row">
          <span class="label">Overall (Σ wᵢ·sᵢ)</span>
          <span class="value">{{ metrics.overall }}/100</span>
        </div>
      </div>

      <div class="card drawer-card">
        <button type="button" class="method-toggle" :aria-expanded="showMethod" @click="showMethod = !showMethod">
          Methodology &amp; Formula <span>{{ showMethod ? '−' : '+' }}</span>
        </button>
        <div v-if="showMethod" class="method">
          <p class="method-formula">Risk Index = <strong>{{ metrics.formula }}</strong>, with Σ wᵢ = 1.0</p>
          <table class="method-table">
            <thead>
              <tr><th>Factor</th><th>Raw value</th><th>wᵢ</th><th>sᵢ</th><th>Source</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in metrics.breakdown" :key="f.id">
                <td>
                  <span class="factor-name">{{ f.label }}</span>
                  <span v-if="f.description" class="factor-note">{{ f.description }}</span>
                </td>
                <td>{{ f.rawValue ?? '—' }}{{ f.unit ? ` ${f.unit}` : '' }}</td>
                <td>{{ f.weight.toFixed(2) }}</td>
                <td>{{ f.subScore }}</td>
                <td :class="f.source === 'PDOK Kadaster WFS' ? 'src-live' : 'src-proxy'">{{ f.source }}</td>
              </tr>
            </tbody>
          </table>
          <p class="disclaimer">
            Prototype Heuristic Index — combines live PDOK Cadastral geometry with simulated
            hydrological weights. Not an actuarial or regulatory model.
          </p>
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
  parcel: { type: Object, default: null },
  isFallback: { type: Boolean, default: false },
  label: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const rootEl = ref(null)
const badgeEl = ref(null)
const animatedValuation = ref('—')
const showMethod = ref(false)

const FACTOR_COLORS = { flood: '#e63946', subsidence: '#e9a13b', fire: '#0071e3', area: '#5e5ce6' }

const cadastre = computed(() => props.parcel?.properties ?? props.metrics?.parcel ?? null)

const metricsKey = computed(() =>
  props.metrics ? `${props.metrics.lat.toFixed(5)},${props.metrics.lng.toFixed(5)}` : 'empty',
)

const riskItems = computed(() => {
  const breakdown = props.metrics?.breakdown ?? []
  return breakdown.map((f) => ({ ...f, color: FACTOR_COLORS[f.id] ?? '#457b9d' }))
})

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
  })
}

function animateBars() {
  nextTick(() => {
    const fills = rootEl.value?.querySelectorAll('.risk-fill')
    if (fills?.length && props.metrics)
      gsap.fromTo(fills, { scaleX: 0 }, { scaleX: (i, el) => Number(el.dataset.risk ? (props.metrics.risks?.[el.dataset.risk] ?? 0) / 100 : 1), duration: 0.6, stagger: 0.08, clearProps: 'transform' })
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
