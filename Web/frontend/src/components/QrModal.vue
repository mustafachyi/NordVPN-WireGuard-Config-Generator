<script setup>
import { useUI } from '@/composables/useUI'
import Icon from '@/components/Icon.vue'

const ui = useUI()
</script>

<template>
  <div
    class="fixed inset-0 z-100 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="qr-title"
    @click="ui.closeQr"
  >
    <div class="fixed inset-0 bg-nord-bg-overlay" />
    <div
      class="relative bg-app-bg rounded-lg border border-app-border overflow-hidden max-w-sm w-full"
      @click.stop
    >
      <div class="bg-nord-bg-overlay-light px-3 py-1.5 text-xs font-medium border-b border-app-border flex items-center justify-between text-nord-text-primary">
        <span id="qr-title">{{ ui.selectedServer.value?.displayName }}</span>
        <button
          type="button"
          aria-label="Close QR code"
          class="p-1 rounded hover:bg-nord-bg-hover"
          @click="ui.closeQr"
        >
          <Icon name="close" class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="p-6 flex justify-center">
        <img
          :src="ui.qrUrl.value"
          :alt="`WireGuard QR code for ${ui.selectedServer.value?.displayName || 'server'}`"
          class="w-50 h-50 rounded"
        >
      </div>
    </div>
  </div>
</template>