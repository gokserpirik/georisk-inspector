<template>
  <div class="chart-grid" ref="rootEl">
    <div class="card chart-card">
      <h3>Risk distribution</h3>
      <div class="chart-box"><canvas ref="doughnutEl"></canvas></div>
    </div>
    <div class="card chart-card">
      <h3>Simulated depreciation (10y)</h3>
      <div class="chart-box"><canvas ref="lineEl"></canvas></div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Chart, DoughnutController, LineController, ArcElement, PointElement, LineElement, LinearScale, CategoryScale, Tooltip, Legend, Filler } from 'chart.js'
import { useReveal } from '../composables/useReveal.js'

Chart.register(DoughnutController, LineController, ArcElement, PointElement, LineElement, LinearScale, CategoryScale, Tooltip, Legend, Filler)

const props = defineProps({
  risks: { type: Object, required: true },
  depreciation: { type: Array, required: true },
})

const rootEl = ref(null)
const doughnutEl = ref(null)
const lineEl = ref(null)
let doughnut = null
let line = null

function buildCharts() {
  const { flood, subsidence, fire } = props.risks
  doughnut = new Chart(doughnutEl.value, {
    type: 'doughnut',
    data: {
      labels: ['Flood', 'Subsidence', 'Fire'],
      datasets: [{ data: [flood, subsidence, fire], backgroundColor: ['#e63946', '#e9a13b', '#0071e3'], borderWidth: 2, borderColor: '#fff' }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
  })
  line = new Chart(lineEl.value, {
    type: 'line',
    data: {
      labels: props.depreciation.map((d) => d.year),
      datasets: [{ label: 'Value (€)', data: props.depreciation.map((d) => d.value), borderColor: '#0071e3', backgroundColor: 'rgba(0,113,227,0.12)', fill: true, tension: 0.3, pointRadius: 2 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => `€${Number(v) / 1000}k` } } } },
  })
}

onMounted(buildCharts)
onUnmounted(() => {
  doughnut?.destroy()
  line?.destroy()
})

watch(
  () => [props.risks, props.depreciation],
  () => {
    if (!doughnut || !line) return
    const { flood, subsidence, fire } = props.risks
    doughnut.data.datasets[0].data = [flood, subsidence, fire]
    doughnut.update()
    line.data.labels = props.depreciation.map((d) => d.year)
    line.data.datasets[0].data = props.depreciation.map((d) => d.value)
    line.update()
  },
  { deep: true },
)

// Chart wrapper entrance
useReveal((gsap, scope) => {
  const cards = scope?.querySelectorAll('.chart-card')
  if (cards?.length) gsap.from(cards, { y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.1, clearProps: 'all' })
}, rootEl)
</script>
