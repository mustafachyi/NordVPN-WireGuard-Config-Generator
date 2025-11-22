<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from '@/components/Icon.vue'

const STYLES = {
  success: 'bg-nord-success-bg border-nord-success-text/20 text-nord-success-text shadow-nord-success-text/10',
  error: 'bg-nord-load-critical-bg border-nord-load-critical-text/20 text-nord-load-critical-text shadow-nord-load-critical-text/10'
}

const props = defineProps({ msg: String, type: { type: String, default: 'success' } })
const emit = defineEmits(['close'])
const visible = ref(false)
let t1, t2

const close = () => {
  visible.value = false
  t2 = setTimeout(() => emit('close'), 200)
}

onMounted(() => {
  requestAnimationFrame(() => {
    visible.value = true
    if (props.type === 'success') t1 = setTimeout(close, 3000)
  })
})

onBeforeUnmount(() => { clearTimeout(t1); clearTimeout(t2) })
</script>

<template>
  <div class="fixed bottom-4 right-4 z-[100] transition-[transform,opacity] duration-200" :class="[visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0', STYLES[type]]">
    <div class="px-3 py-2 rounded border border-current shadow-lg flex items-center gap-3">
      <Icon :name="type === 'error' ? 'error' : 'check'" class="w-4 h-4 shrink-0" />
      <span class="text-sm">{{ msg }}</span>
      <button @click="close" class="p-1 rounded-full hover:bg-white/10"><Icon name="close" class="w-3 h-3" /></button>
    </div>
  </div>
</template>