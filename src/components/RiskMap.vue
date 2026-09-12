<template>
  <div class="map-pane" ref="paneEl">
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
      <l-geo-json
        :key="'flood'"
        :geojson="floodZones"
        :options="floodOptions"
      />
      <l-geo-json
        :key="footprintKey"
        :geojson="footprint"
        :options="footprintOptions"
      />
      <l-marker :lat-lng="center" :icon="parcelIcon">
        <l-popup>Parcel {{ center[0].toFixed(4) }}, {{ center[1].toFixed(4) }}</l-popup>
      </l-marker>
    </l-map>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import L from 'leaflet'
import { LMap, LTileLayer, LMarker, LPopup, LGeoJson } from '@vue-leaflet/vue-leaflet'
import floodZones from '../data/mockFloodZones.json'
import { gsap } from '../lib/gsap.js'

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
})

const zoom = ref(15)
const center = computed(() => [props.lat, props.lng]) // [lat, lng] for markers
const paneEl = ref(null)
const mapInstance = ref(null)

// Custom divIcon avoids the broken default-icon asset issue entirely
const parcelIcon = L.divIcon({
  html: '<div class="parcel-pin"></div>',
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -9],
})

const riskColors = { high: '#e63946', medium: '#e9a13b', low: '#2a9d48' }
const floodOptions = {
  style: (feature) => ({
    color: riskColors[feature.properties?.risk] ?? '#457b9d',
    weight: 2,
    fillOpacity: 0.25,
  }),
  onEachFeature: (feature, layer) => {
    if (feature.properties?.name) layer.bindPopup(feature.properties.name)
  },
}

// Small building footprint rectangle around the selected parcel.
// GeoJSON coordinates stay [lng, lat].
const footprint = computed(() => {
  const d = 0.0009
  const { lat, lng } = props
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Building footprint' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lng - d, lat - d * 0.6],
              [lng + d, lat - d * 0.6],
              [lng + d, lat + d * 0.6],
              [lng - d, lat + d * 0.6],
              [lng - d, lat - d * 0.6],
            ],
          ],
        },
      },
    ],
  }
})
const footprintKey = computed(() => `${props.lat.toFixed(5)},${props.lng.toFixed(5)}`)
const footprintOptions = {
  style: () => ({ color: '#1d1d1f', weight: 2, fillColor: '#0071e3', fillOpacity: 0.35 }),
}

function onMapReady(map) {
  mapInstance.value = map
  // Frame the static flood + footprint area on first load
  const bounds = L.geoJSON(floodZones).getBounds()
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.15))
}

function popMarker() {
  nextTick(() => {
    const el = paneEl.value?.querySelector('.parcel-pin')
    if (el) gsap.fromTo(el, { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(1.7)', clearProps: 'transform' })
  })
}

watch(center, (c) => {
  mapInstance.value?.flyTo(c, 15, { duration: 0.8 })
  popMarker()
})
</script>
