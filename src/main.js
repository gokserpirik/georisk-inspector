import { createApp } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './assets/main.css'
import App from './App.vue'
import router from './router/index.js'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix default marker icons under Vite (Leaflet's relative paths don't resolve)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, shadowUrl: iconShadow })

createApp(App).use(router).mount('#app')
