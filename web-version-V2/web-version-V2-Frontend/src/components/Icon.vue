<script setup>
import { icons } from '@/utils/icons'
const VB = { downloadConfig: '0 0 48 48', menu: '0 0 50 50', github: '0 0 98 96' }
defineProps({ name: { type: String, required: true } })
</script>
<template>
  <svg :viewBox="VB[name] || '0 0 24 24'" fill="currentColor" role="presentation" aria-hidden="true">
    <path :d="icons[name]"/>
  </svg>
</template>