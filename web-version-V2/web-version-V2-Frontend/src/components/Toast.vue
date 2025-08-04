<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const ANIMATION_DURATION_MS = 200
const DISPLAY_DURATION_MS = 2000

const props = defineProps({
  message: { type: String, required: true },
  type: {
    type: String,
    default: 'success',
    validator: value => ['success', 'error'].includes(value)
  }
})

const emit = defineEmits(['close'])

const isVisible = ref(false)
let hideTimeoutId = null
let closeTimeoutId = null

const STYLE_MAP = {
  success: 'bg-nord-success-bg border-nord-success-text/20 text-nord-success-text shadow-nord-success-text/10',
  error: 'bg-nord-load-critical-bg border-nord-load-critical-text/20 text-nord-load-critical-text shadow-nord-load-critical-text/10'
}

const ICON_MAP = {
  success: 'check',
  error: 'error'
}

onMounted(() => {
  requestAnimationFrame(() => {
    isVisible.value = true
    hideTimeoutId = setTimeout(() => {
      isVisible.value = false
      closeTimeoutId = setTimeout(() => emit('close'), ANIMATION_DURATION_MS)
    }, DISPLAY_DURATION_MS)
  })
})

onBeforeUnmount(() => {
  clearTimeout(hideTimeoutId)
  clearTimeout(closeTimeoutId)
})
</script>

<template>
  <div
    class="fixed bottom-4 right-4 z-[100] transition-transform transition-opacity duration-200"
    :class="[isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0', STYLE_MAP[type]]"
    role="alert"
  >
    <div class="px-4 py-2 rounded border border-current shadow-lg flex items-center gap-2">
      <Icon :name="ICON_MAP[type]" class="w-4 h-4" />
      <span class="text-sm">{{ message }}</span>
    </div>
  </div>
</template>