<script setup>
import Icon from '@/components/Icon.vue'

const ACTIONS = [
  { event: 'download', icon: 'downloadConfig', label: 'Download' },
  { event: 'copy', icon: 'copyConfig', label: 'Copy' },
  { event: 'show-qr', icon: 'showQr', label: 'QR Code' },
]

const props = defineProps({
  server: { type: Object, required: true },
})

const emit = defineEmits(['download', 'copy', 'show-qr', 'copy-ip'])

const getLoadClass = load => {
  if (load <= 20) return 'bg-nord-load-low-bg text-nord-load-low-text'
  if (load <= 40) return 'bg-nord-load-medium-bg text-nord-load-medium-text'
  if (load <= 60) return 'bg-nord-load-warning-bg text-nord-load-warning-text'
  if (load <= 80) return 'bg-nord-load-high-bg text-nord-load-high-text'
  return 'bg-nord-load-critical-bg text-nord-load-critical-text'
}

const getTags = mask => {
  if (!mask) return []

  const tags = []
  if (mask & 1) tags.push('Standard')
  if (mask & 2) tags.push('P2P')
  if (mask & 4) tags.push('Dedicated IP')
  if (mask & 8) tags.push('Onion')
  if (mask & 16) tags.push('Double VPN')
  return tags
}

const copyIp = () => {
  if (props.server.ip) {
    emit('copy-ip', props.server.ip)
  }
}
</script>

<template>
  <article class="relative flex flex-col justify-between md:hover:z-10 p-2.5 bg-nord-bg-card border-l-2 border-transparent md:hover:border-nord-button-primary md:hover:bg-nord-bg-hover group transition-transform duration-150 md:hover:scale-[1.02] min-h-24">
    <div class="flex justify-between items-start gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="font-medium truncate">{{ server.displayName }}</h3>
        <p class="text-sm text-nord-text-secondary truncate">
          {{ server.displayCountry }} - {{ server.displayCity }}
        </p>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <span
          :class="[
            'text-xs px-1.5 py-0.5 rounded font-medium',
            getLoadClass(server.load),
          ]"
        >
          {{ server.load }}%
        </span>

        <div class="flex gap-0.5">
          <button
            v-for="action in ACTIONS"
            :key="action.event"
            type="button"
            class="p-2 rounded border border-transparent md:hover:bg-nord-bg-active"
            :aria-label="action.label"
            @click.stop="emit(action.event)"
          >
            <Icon :name="action.icon" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <div class="mt-2 flex flex-wrap items-center justify-end gap-1.5 min-h-6">
      <button
        v-if="server.ip"
        type="button"
        class="mr-auto -ml-1.5 px-1.5 py-0.5 rounded text-sm font-medium text-nord-text-secondary/50 truncate hover:text-nord-text-primary hover:bg-nord-bg-active transition-colors hidden group-[.show-ips]/grid:block"
        @click.stop="copyIp"
      >
        {{ server.ip }}
      </button>

      <span
        v-for="tag in getTags(server.groupMask)"
        :key="tag"
        class="px-2 py-0.5 rounded bg-nord-button-secondary/40 border border-nord-button-secondary text-nord-text-primary text-xs font-medium shadow-sm"
      >
        {{ tag }}
      </span>
    </div>
  </article>
</template>