<template>
  <div class="chart-grid" ref="rootEl">
    <div class="card chart-card">
      <h3>Relative sub-scores (unweighted)</h3>
      <div class="chart-box"><canvas ref="doughnutEl"></canvas></div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js'
import { useReveal } from '../composables/useReveal.js'

Chart.register(DoughnutController, ArcElement, Tooltip, Legend)

const props = defineProps({
  risks: { type: Object, required: true },
})

const rootEl = ref(null)
const doughnutEl = ref(null)
let doughnut = null

const FACTOR_LABELS = {
  flood: { label: 'Flood', color: '#e63946' },
  subsidence: { label: 'Subsidence', color: '#e9a13b' },
  fire: { label: 'Fire', color: '#0071e3' },
  area: { label: 'Area', color: '#5e5ce6' },
}

function doughnutData() {
  const keys = Object.keys(FACTOR_LABELS).filter((k) => k in (props.risks ?? {}))
  return {
    labels: keys.map((k) => FACTOR_LABELS[k].label),
    values: keys.map((k) => Number(props.risks?.[k]) || 0),
    colors: keys.map((k) => FACTOR_LABELS[k].color),
  }
}

function buildCharts() {
  const { labels, values, colors } = doughnutData()
  doughnut = new Chart(doughnutEl.value, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
  })
}

onMounted(buildCharts)
onUnmounted(() => {
  doughnut?.destroy()
  doughnut = null
})

watch(
  () => props.risks,
  () => {
    if (!doughnut) return
    const { labels, values, colors } = doughnutData()
    doughnut.data.labels = labels
    doughnut.data.datasets[0].data = values
    doughnut.data.datasets[0].backgroundColor = colors
    doughnut.update()
  },
  { deep: true },
)

// Chart wrapper entrance
useReveal((gsap, scope) => {
  const cards = scope?.querySelectorAll('.chart-card')
  if (cards?.length) gsap.from(cards, { y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.1, clearProps: 'all' })
}, rootEl)
</script>
