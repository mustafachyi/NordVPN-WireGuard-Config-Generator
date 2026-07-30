<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'

const DISPLAY_DURATION_MS = 2_000
const TRANSITION_DURATION_MS = 200
const STYLES = {
  success: 'bg-nord-success-bg border-nord-success-text/20 text-nord-success-text shadow-nord-success-text/10',
  error: 'bg-nord-load-critical-bg border-nord-load-critical-text/20 text-nord-load-critical-text shadow-nord-load-critical-text/10',
}

const props = defineProps({
  msg: { type: String, required: true },
  type: { type: String, default: 'success' },
})

const emit = defineEmits(['close'])
const visible = ref(false)
let animationFrameId
let displayTimer
let closeTimer

const close = () => {
  visible.value = false
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => emit('close'), TRANSITION_DURATION_MS)
}

onMounted(() => {
  animationFrameId = requestAnimationFrame(() => {
    visible.value = true
    displayTimer = setTimeout(close, DISPLAY_DURATION_MS)
  })
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrameId)
  clearTimeout(displayTimer)
  clearTimeout(closeTimer)
})
</script>

<template>
  <div
    class="fixed bottom-4 right-4 z-100 transition-[transform,opacity] duration-200"
    :class="[
      visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      STYLES[type],
    ]"
    :role="type === 'error' ? 'alert' : 'status'"
    :aria-live="type === 'error' ? 'assertive' : 'polite'"
  >
    <div class="px-3 py-2 rounded border border-current shadow-lg flex items-center gap-3">
      <Icon
        :name="type === 'error' ? 'error' : 'check'"
        class="w-4 h-4 shrink-0"
      />
      <span class="text-sm">{{ msg }}</span>
      <button
        type="button"
        aria-label="Close notification"
        class="p-1 rounded-full hover:bg-white/10"
        @click="close"
      >
        <Icon name="close" class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>