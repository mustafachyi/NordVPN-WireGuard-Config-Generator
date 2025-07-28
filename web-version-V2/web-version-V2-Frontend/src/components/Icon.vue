<script setup>
import { computed } from 'vue'
import { icons } from '../utils/icons'

const props = defineProps({
  name: { type: String, required: true }
})

const viewBox = computed(() => {
  if (props.name === 'nord' || props.name === 'downloadConfig') return '0 0 48 48'
  if (props.name === 'menu') return '0 0 50 50'
  return '0 0 24 24'
})
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