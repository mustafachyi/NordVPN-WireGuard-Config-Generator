<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { icons } from '../utils/icons'

// Constants
const ANIMATION_DURATION = 200
const DISPLAY_DURATION = 2000

// Props with validation
defineProps({
  message: { type: String, required: true },
  type: { 
    type: String, 
    default: 'info',
    validator: value => ['info', 'success', 'error'].includes(value)
  }
})

const emit = defineEmits(['close'])
const isVisible = ref(false)
let hideTimeout
let closeTimeout

// Memoized style maps
const STYLE_MAP = {
  info: 'bg-nord-bg-overlay border-nord-text-primary/20 text-nord-text-primary shadow-nord-text-primary/10',
  success: 'bg-nord-success-bg border-nord-success-text/20 text-nord-success-text shadow-nord-success-text/10',
  error: 'bg-nord-load-critical-bg border-nord-load-critical-text/20 text-nord-load-critical-text shadow-nord-load-critical-text/10'
}

const ICON_MAP = {
  success: 'check',
  error: 'error',
  info: 'info'
}

// Lifecycle
onMounted(() => {
  requestAnimationFrame(() => {
    isVisible.value = true
    hideTimeout = setTimeout(() => {
      isVisible.value = false
      closeTimeout = setTimeout(() => emit('close'), ANIMATION_DURATION)
    }, DISPLAY_DURATION)
  })
})

onBeforeUnmount(() => {
  clearTimeout(hideTimeout)
  clearTimeout(closeTimeout)
})
</script>

<template>
  <div 
    class="fixed bottom-4 right-4 z-[100] transition-transform transition-opacity duration-200"
    :class="[isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0', STYLE_MAP[type]]"
    role="alert"
  >
    <div class="px-4 py-2 rounded border border-current shadow-lg flex items-center gap-2">
      <svg class="w-4 h-4" viewBox="0 0 24 24" role="img" aria-hidden="true">
        <path fill="currentColor" :d="icons[ICON_MAP[type]]"/>
      </svg>
      <span class="text-sm">{{ message }}</span>
    </div>
  </div>
</template>
