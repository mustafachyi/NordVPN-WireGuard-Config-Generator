<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useServers } from '@/composables/useServers'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import ServerCard from '@/components/ServerCard.vue'
import Icon from '@/components/Icon.vue'

const servers = useServers()
const config = useConfig()
const ui = useUI()
const notifications = useToast()

const sentinel = ref(null)
let observer = null

const emptyMessage = computed(() => {
  if (servers.error.value) return servers.error.value

  if (servers.selectedCountry.value || servers.selectedGroup.value) {
    return 'No servers match the selected criteria.'
  }

  return 'No servers loaded.'
})

const download = server => {
  try {
    config.download(server)
    notifications.show('Downloaded', 'success')
  } catch (error) {
    notifications.show(error.message || 'Download failed', 'error')
  }
}

const copy = async server => {
  try {
    await config.copy(server)
    notifications.show('Copied', 'success')
  } catch (error) {
    notifications.show(error.message || 'Copy failed', 'error')
  }
}

const copyIp = async ip => {
  try {
    await navigator.clipboard.writeText(ip)
    notifications.show('IP copied', 'success')
  } catch (error) {
    notifications.show(error.message || 'IP copy failed', 'error')
  }
}

const showQr = server => {
  ui.showQr(server, () => config.getQrBlob(server))
    .catch(error => notifications.show(
      error.message || 'QR generation failed',
      'error',
    ))
}

const observeSentinel = async () => {
  await nextTick()
  observer?.disconnect()

  if (sentinel.value) {
    observer?.observe(sentinel.value)
  }
}

const loadMore = async () => {
  const visibleCount = servers.visibleServers.value.length
  servers.loadMore()

  if (servers.visibleServers.value.length > visibleCount) {
    await observeSentinel()
  }
}

onMounted(() => {
  observer = new IntersectionObserver(entries => {
    if (entries[0]?.isIntersecting) {
      void loadMore()
    }
  }, { rootMargin: '200px' })

  void observeSentinel()
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

watch(
  [
    servers.selectedGroup,
    servers.selectedCountry,
    servers.selectedCity,
    servers.sortField,
    servers.sortOrder,
    servers.loading,
  ],
  observeSentinel,
)
</script>

<template>
  <main class="container mx-auto px-4 py-6">
    <div
      v-if="servers.visibleServers.value.length > 0"
      class="server-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mx-auto group/grid"
      :class="{ 'show-ips': ui.showIp.value }"
    >
      <ServerCard
        v-for="server in servers.visibleServers.value"
        :key="server.fileName"
        v-memo="[server]"
        :server="server"
        @download="download(server)"
        @copy="copy(server)"
        @show-qr="showQr(server)"
        @copy-ip="copyIp"
      />
    </div>

    <div v-else-if="!servers.loading.value" class="text-center py-20">
      <Icon
        name="error"
        class="w-12 h-12 mx-auto text-nord-text-secondary/50 mb-4"
      />
      <p class="text-nord-text-secondary font-medium">{{ emptyMessage }}</p>
    </div>

    <div ref="sentinel" class="h-10" />

    <div v-if="servers.loading.value" class="flex justify-center py-4">
      <div
        class="w-6 h-6 border-2 border-app-accent border-t-transparent rounded-full animate-spin"
      />
    </div>
  </main>
</template>