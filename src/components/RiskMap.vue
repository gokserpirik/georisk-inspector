<template>
  <div class="map-pane" ref="paneEl">
    <div v-if="isFallback" class="map-badge" role="status">
      Offline / Fallback Mode — parcel data unavailable
    </div>
    <button
      type="button"
      class="map-toggle"
      :class="{ active: showAhn }"
      :aria-pressed="showAhn"
      @click="showAhn = !showAhn"
    >
      {{ showAhn ? 'Hide' : 'Show' }} AHN elevation
    </button>
    <l-map
      :zoom="zoom"
      :center="center"
      style="height: 100%; width: 100%"
      @ready="onMapReady"
    >
      <l-tile-layer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
        :max-zoom="19"
      />
      <!-- AHN elevation raster. It is a GridLayer, so Leaflet places it in
           .leaflet-tile-pane (z-index 200) while GeoJSON paths live in
           .leaflet-overlay-pane (z-index 400): the parcel polygons — and the red
           selected-parcel highlight — always draw on top of the raster. -->
      <l-wms-tile-layer
        v-if="showAhn"
        url="https://service.pdok.nl/rws/ahn/wms/v1_0"
        layers="dtm_05m"
        format="image/png"
        styles=""
        version="1.3.0"
        transparent
        :opacity="0.65"
        attribution="AHN &copy; PDOK / Rijkswaterstaat"
      />
      <l-geo-json
        :key="'flood'"
        :geojson="floodZones"
        :options="floodOptions"
        :options-style="floodStyle"
      />
      <l-geo-json
        v-if="parcelGeojson"
        :key="parcelKey"
        :geojson="parcelGeojson"
        :options="parcelOptions"
        :options-style="parcelStyle"
      />
      <l-marker :lat-lng="center" :icon="parcelIcon">
        <l-popup>Parcel {{ center[0].toFixed(4) }}, {{ center[1].toFixed(4) }}</l-popup>
      </l-marker>
    </l-map>
  </div>
</template>

<script setup>
import { computed, ref, shallowRef, watch, nextTick, onUnmounted } from 'vue'
import L from 'leaflet'
import { LMap, LTileLayer, LMarker, LPopup, LGeoJson, LWmsTileLayer } from '@vue-leaflet/vue-leaflet'
import floodZones from '../data/mockFloodZones.json'
import { gsap } from '../lib/gsap.js'

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  parcel: { type: Object, default: null },
  isFallback: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])

const zoom = ref(15)
const center = computed(() => [props.lat, props.lng]) // [lat, lng] for markers
const paneEl = ref(null)
// Leaflet objects must stay OUT of Vue's deep reactivity: a proxied map breaks
// internal _leaflet_pos bookkeeping during zoom/pan.
const mapInstance = shallowRef(null)
const showAhn = ref(false)

const parcelGeojson = computed(() => props.parcel?.geojson ?? null)
const parcelKey = computed(() => `${props.lat.toFixed(6)},${props.lng.toFixed(6)}`)

// Custom divIcon avoids the broken default-icon asset issue entirely
const parcelIcon = L.divIcon({
  html: '<div class="parcel-pin"></div>',
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -9],
})

const riskColors = { high: '#e63946', medium: '#e9a13b', low: '#2a9d48' }
const floodStyle = (feature) => ({
  color: riskColors[feature.properties?.risk] ?? '#457b9d',
  weight: 2,
  fillOpacity: 0.25,
})
const floodOptions = {
  onEachFeature: (feature, layer) => {
    const name = feature.properties?.name
    if (name) layer.bindPopup(`${name} <em>(demo polygon)</em>`)
  },
}

// Real cadastral parcel boundaries (PDOK Kadaster WFS v5): hover + selection styling.
// vue-leaflet applies path styling through the dedicated `optionsStyle` prop, not `options`.
const DEFAULT_PARCEL_STYLE = { color: '#0071e3', weight: 1.5, fillColor: '#0071e3', fillOpacity: 0.06 }
const SELECTED_PARCEL_STYLE = { color: '#e63946', weight: 3, fillColor: '#e63946', fillOpacity: 0.2 }

function isSelectedFeature(feature) {
  const s = props.parcel?.properties
  if (!s) return false
  const p = feature?.properties ?? {}
  return (
    p.kadastraleGemeenteCode === s.gemeenteCode &&
    p.sectie === s.sectie &&
    p.perceelnummer === s.perceelnummer
  )
}

const parcelStyle = (feature) => (isSelectedFeature(feature) ? { ...SELECTED_PARCEL_STYLE } : { ...DEFAULT_PARCEL_STYLE })

const parcelOptions = {
  onEachFeature: (feature, layer) => {
    const p = feature?.properties ?? {}
    if (p.kadastraleGemeenteWaarde) {
      const area = Number(p.kadastraleGrootteWaarde)
      layer.bindPopup(
        `<strong>${p.kadastraleGemeenteWaarde} ${p.sectie}-${p.perceelnummer}</strong>` +
          (Number.isFinite(area) ? `<br>${Math.round(area).toLocaleString('en-US')} m²` : ''),
      )
    }
    layer.on('mouseover', () => layer.setStyle({ weight: 3, fillOpacity: 0.24 }))
    layer.on('mouseout', () =>
      layer.setStyle(isSelectedFeature(feature) ? { ...SELECTED_PARCEL_STYLE } : { ...DEFAULT_PARCEL_STYLE }),
    )
  },
}

function onMapReady(map) {
  mapInstance.value = map
  // Click anywhere to inspect the cadastral parcel at that point.
  map.on('click', (e) => emit('select', { lat: e.latlng.lat, lng: e.latlng.lng }))
}

function popMarker() {
  nextTick(() => {
    const el = paneEl.value?.querySelector('.parcel-pin')
    if (el) gsap.fromTo(el, { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(1.7)', clearProps: 'transform' })
  })
}

// Frame the live parcel; fall back to a fixed zoom when unavailable.
watch(
  () => props.parcel,
  (parcel) => {
    const map = mapInstance.value
    const features = parcel?.geojson?.features
    if (map && features?.length) {
      const bounds = L.geoJSON(parcel.geojson).getBounds()
      if (bounds.isValid()) map.flyToBounds(bounds.pad(0.4), { duration: 0.8 })
      popMarker()
    }
  },
)

watch(center, (c) => {
  mapInstance.value?.flyTo(c, 15, { duration: 0.8 })
  popMarker()
})

onUnmounted(() => {
  mapInstance.value?.off()
  mapInstance.value?.remove()
  mapInstance.value = null
})
</script>
