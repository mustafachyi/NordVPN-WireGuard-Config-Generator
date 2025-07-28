<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'

const LOAD_THRESHOLDS = [
  { max: 20, style: 'bg-nord-load-low-bg text-nord-load-low-text' },
  { max: 40, style: 'bg-nord-load-medium-bg text-nord-load-medium-text' },
  { max: 60, style: 'bg-nord-load-warning-bg text-nord-load-warning-text' },
  { max: 80, style: 'bg-nord-load-high-bg text-nord-load-high-text' },
  { max: Infinity, style: 'bg-nord-load-critical-bg text-nord-load-critical-text' }
]

const ACTIONS = [
  { emitName: 'download-config', label: 'Download configuration', icon: 'downloadConfig' },
  { emitName: 'copy-config', label: 'Copy configuration', icon: 'copyConfig' },
  { emitName: 'show-qr', label: 'Show QR code', icon: 'showQr' }
]

const props = defineProps({
  name: { type: String, required: true },
  country: { type: String, required: true },
  city: { type: String, required: true },
  ip: { type: String, required: false },
  showIp: { type: Boolean, default: false },
  load: { type: Number, required: true }
})

const emit = defineEmits([
  'download-config',
  'copy-config',
  'show-qr',
  'copy-ip'
])

const loadStyle = computed(() => {
  return LOAD_THRESHOLDS.find(t => props.load <= t.max).style
})

const copyIpToClipboard = () => {
  if (props.ip) {
    navigator.clipboard.writeText(props.ip)
    emit('copy-ip')
  }
}
</script>

<template>
  <article class="p-2.5 bg-nord-bg-card border-l-2 border-transparent md:hover:border-nord-button-primary md:hover:bg-nord-bg-hover cursor-pointer group transition-colors" role="article">
    <div class="flex justify-between items-start gap-2">
      <div class="min-w-0">
        <h3 class="font-medium text-nord-text-primary truncate">{{ name }}</h3>
        <p class="text-sm text-nord-text-secondary truncate">{{ country }} - {{ city }}</p>
        <button v-if="showIp && ip" type="button" class="text-sm font-medium text-nord-text-secondary/50 truncate px-0 py-0 focus:outline-none hover:text-nord-text-primary transition-colors" @click.stop="copyIpToClipboard" aria-label="Copy server IP">
          {{ ip }}
        </button>
      </div>

      <div class="flex items-center gap-1 shrink-0" role="group" aria-label="Server actions">
        <span :class="['text-xs px-1.5 py-0.5 rounded whitespace-nowrap font-medium', loadStyle]" role="status" aria-label="Server load">{{ load }}%</span>
        <div class="flex gap-0.5">
          <button v-for="action in ACTIONS" :key="action.emitName" @click.stop="$emit(action.emitName)" class="p-1 rounded active:scale-125 transition-transform md:hover:bg-nord-bg-active text-nord-text-primary" :aria-label="action.label">
            <Icon :name="action.icon" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </article>
</template>