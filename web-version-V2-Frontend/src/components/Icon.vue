<script setup>
import { computed } from 'vue'
import { icons } from '../utils/icons'

// Constants
const DEFAULT_SIZE = 24

// Icon configurations
const ICON_CONFIG = {
  nord: { viewBox: '0 0 48 48' },
  downloadConfig: { viewBox: '0 0 48 48' },
  menu: { viewBox: '0 0 50 50' },
  default: { viewBox: '0 0 24 24' }
}

// Props with validation
const props = defineProps({
  name: {
    type: String,
    required: true,
    validator: (value) => value in icons
  },
  size: {
    type: [String, Number],
    default: DEFAULT_SIZE,
    validator: (value) => {
      const num = Number(value)
      return !isNaN(num) && num > 0
    }
  }
})

// Computed
const dimensions = computed(() => {
  const config = ICON_CONFIG[props.name] || ICON_CONFIG.default
  const [, , width, height] = config.viewBox.split(' ').map(Number)
  const ratio = width / DEFAULT_SIZE
  const size = Number(props.size)
  
  return {
    width: size * ratio,
    height: size * ratio
  }
})

const viewBox = computed(() => (ICON_CONFIG[props.name] || ICON_CONFIG.default).viewBox)
</script>

<template>
  <svg 
    v-bind="dimensions"
    :viewBox="viewBox"
    fill="currentColor"
    role="none"
    aria-hidden="true"
  >
    <path :d="icons[name]"/>
  </svg>
</template> 