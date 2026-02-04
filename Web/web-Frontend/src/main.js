import { createApp } from 'vue'
import '@/style.css'
import App from '@/App.vue'
import { storage } from '@/services/storageService'

createApp(App).mount('#app')

setTimeout(() => storage.clean(), 0)