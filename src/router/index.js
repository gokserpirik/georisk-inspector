import { createRouter, createWebHistory } from 'vue-router'

export { DEFAULT_CENTER } from '../lib/location.js'

// App.vue is the root component (mounted in main.js), not a route component.
// Previous version imported App here while App imported DEFAULT_CENTER
// from here — a cycle that threw "Cannot access 'App' before initialization".
// The route component is intentionally an empty stub: App reads useRoute()
// query directly and has no <router-view>.
const EmptyView = { template: '<div></div>' }

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', name: 'home', component: EmptyView }],
})

export default router
