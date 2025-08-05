import { createApp } from 'vue'
import '@/style.css'
import App from '@/App.vue'
import { storageService } from '@/services/storageService'

storageService.cleanup()

createApp(App).mount('#app')