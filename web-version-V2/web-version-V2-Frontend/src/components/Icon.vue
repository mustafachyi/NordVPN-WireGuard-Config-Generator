<script setup>
import { computed } from 'vue'
import { icons } from '@/utils/icons'

const props = defineProps({
  name: { type: String, required: true }
})

const VIEWBOX_MAP = {
  downloadConfig: '0 0 48 48',
  menu: '0 0 50 50',
  github: '0 0 98 96',
}
const DEFAULT_VIEWBOX = '0 0 24 24'

const viewBox = computed(() => VIEWBOX_MAP[props.name] || DEFAULT_VIEWBOX)
</script>

<template>
  <svg
    :viewBox="viewBox"
    fill="currentColor"
    role="presentation"
    aria-hidden="true"
  >
    <path :d="icons[name]"/>
  </svg>
</template>