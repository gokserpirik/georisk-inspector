<template>
  <div class="slice-panel">
    <div class="slice-bar">
      <strong>3D parcel slice</strong>
      <span v-if="slice" class="slice-meta">
        {{ slice.buildings.length }} building{{ slice.buildings.length === 1 ? '' : 's' }} ·
        {{ slice.centreGround == null ? 'ground unavailable' : `ground ${slice.centreGround.toFixed(1)} m NAP` }} · N ↑
      </span>
      <button type="button" class="slice-close" aria-label="Close 3D view" @click="$emit('close')">×</button>
    </div>
    <div ref="mountEl" class="slice-canvas"></div>
    <div v-if="loading" class="slice-state">Loading AHN terrain &amp; BAG buildings…</div>
    <div v-else-if="error" class="slice-state error-state">{{ error }}</div>
    <div v-else-if="slice && (missingTerrain || slice.buildings.some((b) => b.estimated))" class="slice-note">
      <span v-if="missingTerrain">Missing terrain is filled using {{ slice.centreGround == null ? '0 m NAP (no centre-ground data)' : 'the parcel centre ground height' }}. </span>
      <span v-if="slice.buildings.some((b) => b.estimated)">Some building heights use incomplete AHN coverage or a default estimate.</span>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Local frame (see lib/rd.js): X = east, Y = up (NAP metres), Z = south, so
// three.js's default view direction (-Z) faces north.
const props = defineProps({
  slice: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
})
defineEmits(['close'])

const mountEl = ref(null)
const missingTerrain = ref(false)
let renderer, scene, camera, controls, resizeObserver
let content = null

function disposeContent() {
  if (!content) return
  scene.remove(content)
  content.traverse((o) => {
    o.geometry?.dispose()
    if (o.material) [].concat(o.material).forEach((m) => m.dispose())
  })
  content = null
}

function densify(ring, maxStep = 2) {
  const out = []
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStep))
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  return out
}

function buildScene(slice) {
  disposeContent()
  content = new THREE.Group()
  const { frame, dtm, bbox, centreGround } = slice
  const referenceGround = centreGround ?? 0
  const [cx, cy] = frame.centroid
  missingTerrain.value = false
  const ground = (x, y) => {
    const value = dtm.sample(x, y)
    if (value === null) missingTerrain.value = true
    return value ?? referenceGround
  }

  // Terrain: regular grid over the slice window, heights straight from AHN (NAP).
  const w = bbox[2] - bbox[0]
  const h = bbox[3] - bbox[1]
  const seg = 120
  const geo = new THREE.PlaneGeometry(w, h, seg, seg)
  geo.rotateX(-Math.PI / 2) // XY plane -> XZ ground plane; row 0 ends up north (-Z)
  const mid = frame.toLocal([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])
  geo.translate(mid.x, 0, mid.z)
  const pos = geo.attributes.position
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const [rx, ry] = frame.fromLocal({ x: pos.getX(i), z: pos.getZ(i) })
    const y = ground(rx, ry)
    pos.setY(i, y)
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  geo.computeVertexNormals()
  content.add(
    new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x9aa39a, side: THREE.DoubleSide })),
  )
  content.add(new THREE.LineSegments(
    new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x6f786f, transparent: true, opacity: 0.12 }),
  ))

  // Buildings: Shape lives in (east, north); rotateX(-90°) maps shape +Y -> world -Z
  // (north is -Z) and extrusion +Z -> up.
  const wall = new THREE.MeshLambertMaterial({ color: 0xd9d4cc })
  const estimated = new THREE.MeshLambertMaterial({ color: 0xe8c9a0 })
  for (const b of slice.buildings) {
    const toShape = (ring) => ring.map(([x, y]) => new THREE.Vector2(x - cx, y - cy))
    const shape = new THREE.Shape(toShape(b.outer))
    for (const hole of b.holes) shape.holes.push(new THREE.Path(toShape(hole)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.roofNap - b.baseNap, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, b.baseNap, 0)
    content.add(new THREE.Mesh(g, b.estimated ? estimated : wall))
  }

  // Parcel boundary draped on the terrain.
  const pts = densify(slice.ring).map(([x, y]) => {
    const v = frame.toLocal([x, y], ground(x, y) + 0.2)
    return new THREE.Vector3(v.x, v.y, v.z)
  })
  content.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xe63946 }),
  ))

  scene.add(content)

  // Camera: south-east of the parcel, looking north-west at its centroid.
  const r = Math.max(60, Math.min(w, h) * 0.6)
  controls.target.set(0, referenceGround, 0)
  camera.position.set(r * 0.8, referenceGround + r * 0.7, r * 1)
  camera.far = r * 40
  camera.updateProjectionMatrix()
  controls.update()
}

function resize() {
  const el = mountEl.value
  if (!el || !renderer) return
  const { clientWidth: cw, clientHeight: ch } = el
  renderer.setSize(cw, ch)
  camera.aspect = cw / Math.max(1, ch)
  camera.updateProjectionMatrix()
}

onMounted(() => {
  const el = mountEl.value
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xeef2f5)
  scene.add(new THREE.AmbientLight(0xffffff, 0.8))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(-150, 250, 120)
  scene.add(sun)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  el.appendChild(renderer.domElement)

  camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2 - 0.02

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(el)
  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })
  if (props.slice) buildScene(props.slice)
})

watch(
  () => props.slice,
  (s) => {
    if (!scene) return
    if (s) buildScene(s)
    else disposeContent()
  },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  renderer?.setAnimationLoop(null)
  disposeContent()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<style scoped>
.slice-panel {
  position: absolute;
  inset: 0;
  z-index: 1400;
  display: flex;
  flex-direction: column;
  background: #e8e7df;
}
.slice-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.slice-meta {
  color: var(--muted);
  font-size: 0.85rem;
}
.slice-close {
  margin-left: auto;
  border: 0;
  background: transparent;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
}
.slice-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}
.slice-canvas :deep(canvas) {
  display: block;
}
.slice-state,
.slice-note {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--card);
  font-size: 0.9rem;
}
.error-state {
  color: #b42318;
}
@media (max-width: 900px) {
  .slice-panel { position: fixed; }
  .slice-note, .slice-state { width: calc(100% - 32px); }
}
</style>
