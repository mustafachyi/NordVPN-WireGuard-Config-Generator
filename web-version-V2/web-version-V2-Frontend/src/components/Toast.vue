<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'

const ANIMATION_DURATION_MS = 200
const DISPLAY_DURATION_MS = 3000

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

const closeToast = () => {
  clearTimeout(hideTimeoutId)
  clearTimeout(closeTimeoutId)
  isVisible.value = false
  closeTimeoutId = setTimeout(() => emit('close'), ANIMATION_DURATION_MS)
}

onMounted(() => {
  requestAnimationFrame(() => {
    isVisible.value = true
    if (props.type === 'success') {
      hideTimeoutId = setTimeout(closeToast, DISPLAY_DURATION_MS)
    }
  })
})

onBeforeUnmount(() => {
  clearTimeout(hideTimeoutId)
  clearTimeout(closeTimeoutId)
})
</script>

<template>
  <div
    class="fixed bottom-4 right-4 z-[100] transition duration-200"
    :class="[isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0', STYLE_MAP[type]]"
    role="alert"
  >
    <div class="px-3 py-2 rounded border border-current shadow-lg flex items-center gap-3">
      <Icon :name="ICON_MAP[type]" class="w-4 h-4 shrink-0" />
      <span class="text-sm">{{ message }}</span>
      <button @click="closeToast" class="p-1 rounded-full hover:bg-white/10" aria-label="Close notification">
        <Icon name="close" class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>