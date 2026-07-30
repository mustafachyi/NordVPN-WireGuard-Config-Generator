import { createApp } from 'vue'
import '@/style.css'
import App from '@/App.vue'

const root = document.documentElement

window.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    root.dataset.inputModality = 'keyboard'
  }
}, { capture: true })

window.addEventListener('pointerdown', () => {
  delete root.dataset.inputModality
}, { capture: true })

createApp(App).mount('#app')