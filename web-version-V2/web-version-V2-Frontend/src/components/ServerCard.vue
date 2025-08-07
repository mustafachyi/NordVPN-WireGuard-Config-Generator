<script setup>
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'

const ACTIONS = [
  { emitName: 'download', label: 'Download configuration', icon: 'downloadConfig' },
  { emitName: 'copy', label: 'Copy configuration', icon: 'copyConfig' },
  { emitName: 'show-qr', label: 'Show QR code', icon: 'showQr' },
]

const props = defineProps({
  server: { type: Object, required: true },
  showIp: { type: Boolean, default: false },
})

const emit = defineEmits(['download', 'copy', 'show-qr', 'copy-ip'])

const loadStyle = computed(() => {
  const load = props.server.load
  if (load <= 20) return 'bg-nord-load-low-bg text-nord-load-low-text'
  if (load <= 40) return 'bg-nord-load-medium-bg text-nord-load-medium-text'
  if (load <= 60) return 'bg-nord-load-warning-bg text-nord-load-warning-text'
  if (load <= 80) return 'bg-nord-load-high-bg text-nord-load-high-text'
  return 'bg-nord-load-critical-bg text-nord-load-critical-text'
})

const copyIpToClipboard = () => {
  if (props.server.ip) {
    navigator.clipboard.writeText(props.server.ip)
    emit('copy-ip')
  }
}
</script>

<template>
  <article class="p-2.5 bg-nord-bg-card border-l-2 border-transparent md:hover:border-nord-button-primary md:hover:bg-nord-bg-hover group transition-transform duration-150 md:hover:scale-[1.02] [will-change:transform]">
    <div class="flex justify-between items-start gap-2">
      <div class="min-w-0">
        <h3 class="font-medium truncate">{{ server.displayName }}</h3>
        <p class="text-sm text-nord-text-secondary truncate">{{ server.displayCountry }} - {{ server.displayCity }}</p>
        <button v-if="showIp && server.ip" type="button" class="text-sm font-medium text-nord-text-secondary/50 truncate hover:text-nord-text-primary" @click.stop="copyIpToClipboard">
          {{ server.ip }}
        </button>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <span :class="['text-xs px-1.5 py-0.5 rounded font-medium', loadStyle]">{{ server.load }}%</span>
        <div class="flex gap-0.5">
          <button v-for="action in ACTIONS" :key="action.emitName" @click.stop="emit(action.emitName)" class="p-1 rounded border border-transparent md:hover:bg-nord-bg-active" :aria-label="action.label">
            <Icon :name="action.icon" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </article>
</template>