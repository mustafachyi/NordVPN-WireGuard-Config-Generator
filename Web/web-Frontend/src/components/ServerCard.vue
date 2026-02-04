<script setup>
import Icon from '@/components/Icon.vue'

const ACTIONS = [
  { evt: 'download', icon: 'downloadConfig', label: 'Download' },
  { evt: 'copy', icon: 'copyConfig', label: 'Copy' },
  { evt: 'show-qr', icon: 'showQr', label: 'QR Code' }
]

const props = defineProps({ s: { type: Object, required: true } })
const emit = defineEmits(['download', 'copy', 'show-qr', 'copy-ip'])

const getLoadClass = l => {
  if (l <= 20) return 'bg-nord-load-low-bg text-nord-load-low-text'
  if (l <= 40) return 'bg-nord-load-medium-bg text-nord-load-medium-text'
  if (l <= 60) return 'bg-nord-load-warning-bg text-nord-load-warning-text'
  if (l <= 80) return 'bg-nord-load-high-bg text-nord-load-high-text'
  return 'bg-nord-load-critical-bg text-nord-load-critical-text'
}

const copyIp = () => {
  if (props.s.ip) {
    navigator.clipboard.writeText(props.s.ip)
    emit('copy-ip')
  }
}
</script>

<template>
  <article class="relative md:hover:z-10 p-2.5 bg-nord-bg-card border-l-2 border-transparent md:hover:border-nord-button-primary md:hover:bg-nord-bg-hover group transition-transform duration-150 md:hover:scale-[1.02] [will-change:transform]">
    <div class="flex justify-between items-start gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="font-medium truncate">{{ s.dName }}</h3>
        <p class="text-sm text-nord-text-secondary truncate">{{ s.dCountry }} - {{ s.dCity }}</p>
        <button v-if="s.ip" type="button" class="mt-1 px-1.5 py-0.5 -ml-1.5 rounded text-sm font-medium text-nord-text-secondary/50 truncate hover:text-nord-text-primary hover:bg-nord-bg-active transition-colors hidden group-[.show-ips]/grid:inline-block" @click.stop="copyIp">
          {{ s.ip }}
        </button>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <span :class="['text-xs px-1.5 py-0.5 rounded font-medium', getLoadClass(s.load)]">{{ s.load }}%</span>
        <div class="flex gap-0.5">
          <button v-for="a in ACTIONS" :key="a.evt" @click.stop="emit(a.evt)" class="p-2 rounded border border-transparent md:hover:bg-nord-bg-active" :aria-label="a.label">
            <Icon :name="a.icon" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </article>
</template>