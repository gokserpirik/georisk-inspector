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
        <div class="parcel-name">{{ cadastre?.gemeente ? `${cadastre.gemeente} · ${cadastre.sectie || '—'}-${cadastre.perceelnummer ?? '—'}` : (label || 'Selected location') }}</div>
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
        <div v-if="parcel?.match === 'contains'" class="coords">Confirmed: click lies within this parcel.</div>
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
            Approximate match: nearest parcel centroid{{ parcel?.distanceM != null ? ` (${parcel.distanceM} m away)` : '' }}. The click is not inside this parcel.
          </div>
        </template>
        <div v-else-if="isFallback" class="coords">Parcel data unavailable. Try again when the service is reachable.</div>
        <div v-else-if="parcel?.incomplete" class="coords">Parcel lookup incomplete; no approximate match was selected.</div>
        <div v-else class="coords">No cadastral parcel at this point (road, water or outside NL).</div>
        <div v-if="parcel?.incomplete" class="coords">Parcel results are incomplete for this area.</div>
      </div>

      <div class="card drawer-card">
        <h3>Elevation</h3>
        <div class="metric-row">
          <span class="label">Elevation (NAP)</span>
          <span class="value" :title="metrics.elevationSource ? `Source: ${metrics.elevationSource}` : ''">
            {{ metrics.elevation == null ? 'Unavailable' : `${metrics.elevation.toFixed(1)} m NAP` }}
          </span>
        </div>
      </div>

      <div class="card drawer-card">
        <h3>Heuristic Risk Index (Prototype)</h3>
        <p class="coords">Uses fictional Rotterdam demo polygons and unvalidated proxy scores; outside a demo polygon does not mean safe. Not a regulatory or actuarial assessment.</p>
        <p v-if="metrics.elevation == null" class="coords">Elevation unavailable; elevation-dependent scores and the overall index are withheld.</p>
        <div v-for="item in riskItems" :key="item.id" class="risk-bar">
          <div class="bar-head">
            <span>{{ item.label }}</span>
            <strong>{{ item.subScore == null ? 'Unavailable' : `${item.subScore}/100` }}</strong>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill risk-fill"
              :data-risk="item.id"
              :style="{ background: item.color, transform: `scaleX(${(item.subScore ?? 0) / 100})` }"
            ></div>
          </div>
        </div>
        <div class="metric-row">
          <span class="label">Overall (Σ wᵢ·sᵢ)</span>
          <span class="value">{{ metrics.overall == null ? 'Unavailable' : `${metrics.overall}/100` }}</span>
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
                <td>{{ f.subScore ?? '—' }}</td>
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

      <RiskChart v-if="metrics.overall != null" :risks="metrics.risks" :key="metricsKey" />
    </template>
  </aside>
</template>

<script setup>
import { computed, ref, watch, nextTick, defineAsyncComponent } from 'vue'
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

const RiskChart = defineAsyncComponent(() => import('./RiskChart.vue'))

const rootEl = ref(null)
const badgeEl = ref(null)
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

function animateBars() {
  nextTick(() => {
    const fills = rootEl.value?.querySelectorAll('.risk-fill')
    const risks = props.metrics?.risks
    if (fills?.length && risks)
      gsap.fromTo(fills, { scaleX: 0 }, { scaleX: (i, el) => Number(el.dataset.risk ? (risks[el.dataset.risk] ?? 0) / 100 : 1), duration: 0.6, stagger: 0.08 })
  })
}

function pulseBadge() {
  if (props.metrics?.riskBand !== 'high' || !badgeEl.value) return
  gsap.fromTo(badgeEl.value, { scale: 1 }, { scale: 1.12, duration: 0.35, yoyo: true, repeat: 1, clearProps: 'transform' })
}

function refreshDrawer(m) {
  if (!m) return
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
