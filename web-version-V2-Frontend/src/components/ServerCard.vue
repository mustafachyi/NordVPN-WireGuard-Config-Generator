<script setup>
import { computed } from 'vue'
import { icons } from '../utils/icons'

// Constants
const LOAD_THRESHOLDS = [
  { threshold: 20, style: 'bg-nord-load-low-bg text-nord-load-low-text' },
  { threshold: 40, style: 'bg-nord-load-medium-bg text-nord-load-medium-text' },
  { threshold: 60, style: 'bg-nord-load-warning-bg text-nord-load-warning-text' },
  { threshold: 80, style: 'bg-nord-load-high-bg text-nord-load-high-text' }
]

const ACTIONS = [
  { name: 'download-config', label: 'Download configuration', icon: 'downloadConfig', viewBox: '0 0 48 48' },
  { name: 'copy-config', label: 'Copy configuration', icon: 'copyConfig', viewBox: '0 0 24 24' },
  { name: 'show-qr', label: 'Show QR code', icon: 'showQr', viewBox: '0 0 24 24' }
]

// Props with validation
const props = defineProps({
  name: { type: String, required: true },
  country: { type: String, required: true },
  city: { type: String, required: true },
  load: { 
    type: Number, 
    required: true,
    validator: value => value >= 0 && value <= 100
  }
})

defineEmits(['generate-key', 'download-config', 'copy-config', 'show-qr'])

// Computed
const loadStyle = computed(() => {
  const style = LOAD_THRESHOLDS.find(({ threshold }) => props.load <= threshold)?.style
  return style ?? 'bg-nord-load-critical-bg text-nord-load-critical-text'
})
</script>

<template>
  <article 
    class="p-2.5 bg-nord-bg-card border-l-2 border-transparent md:hover:border-nord-button-primary md:hover:bg-nord-bg-hover cursor-pointer group transition-colors" 
    role="article"
  >
    <div class="flex justify-between items-start gap-2">
      <!-- Server Info -->
      <div class="min-w-0">
        <h3 class="font-medium text-nord-text-primary truncate">{{ name }}</h3>
        <p class="text-sm text-nord-text-secondary truncate">{{ country }} - {{ city }}</p>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1 shrink-0" role="group" aria-label="Server actions">
        <!-- Load Indicator -->
        <span 
          :class="['text-xs px-1.5 py-0.5 rounded whitespace-nowrap font-medium', loadStyle]" 
          role="status" 
          aria-label="Server load"
        >
          {{ load }}%
        </span>

        <!-- Action Buttons -->
        <div class="flex gap-0.5">
          <button 
            v-for="{ name: actionName, label, icon, viewBox } in ACTIONS" 
            :key="actionName"
            @click.stop="$emit(actionName)" 
            class="p-1 rounded active:scale-125 transition-transform md:hover:bg-nord-bg-active text-nord-text-primary" 
            :aria-label="label"
          >
            <svg class="h-4 w-4" :viewBox="viewBox" fill="currentColor" role="img" aria-hidden="true">
              <path :d="icons[icon]"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
