<script setup>
import { onMounted, onUnmounted, ref, watch, nextTick, computed } from 'vue'
import { useServers } from '@/composables/useServers'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import { formatDisplayName, debounce } from '@/utils/utils'
import { apiService } from '@/services/apiService'
import ServerCard from '@/components/ServerCard.vue'
import Toast from '@/components/Toast.vue'
import Icon from '@/components/Icon.vue'
import ConfigCustomizer from '@/components/ConfigCustomizer.vue'
import KeyGenerator from '@/components/KeyGenerator.vue'

const {
  visibleServers,
  isLoading,
  sortBy,
  sortOrder,
  filterCountry,
  filterCity,
  countries,
  citiesForCountry,
  filteredCount,
  loadMoreServers,
  toggleSort,
  loadServers
} = useServers()

const {
  sessionPrivateKey,
  persistedSettings,
  defaultSettings,
  loadPersistedSettings,
  saveSettings,
  setSessionPrivateKey,
  downloadConfig,
  copyConfig,
  prepareConfig
} = useConfig()

const {
  isPanelOpen,
  showScrollTopButton,
  showServerIp,
  showCustomizer,
  showKeyGenerator,
  showQrCode,
  qrCodeUrl,
  selectedServer,
  closePanel,
  togglePanel,
  scrollToTop,
  openCustomizer,
  openKeyGenerator,
  handleShowQR,
  cleanupQrCodeUrl
} = useUI()

const { toast, show: showToast } = useToast()
const sentinel = ref(null)
let observer = null

const isMainViewVisible = computed(() => !showKeyGenerator.value && !showCustomizer.value)

const emptyStateMessage = computed(() => {
  if (filterCountry.value) {
    return 'No servers match your current filter criteria.'
  }
  return 'No servers could be loaded at this time.'
})

const handleUiScroll = debounce(() => {
  showScrollTopButton.value = window.scrollY > 500
}, 150)

const reobserveSentinel = async () => {
  await nextTick()
  if (observer) {
    observer.disconnect()
    if (sentinel.value) {
      observer.observe(sentinel.value)
    }
  }
}

const handleGenerateKey = async (token) => {
  try {
    const { key } = await apiService.generateKey(token)
    setSessionPrivateKey(key)
    showKeyGenerator.value = false
    showToast('Key generated for this session. Save it securely.', 'success')
  } catch (err) {
    const message = err.status === 401 ? 'The provided token is invalid' : 'Key generation failed'
    showToast(message, 'error')
  }
}

const handleApplyConfig = (config) => {
  try {
    setSessionPrivateKey(config.privateKey)
    saveSettings({
      dns: config.dns,
      endpoint: config.endpoint,
      keepalive: config.keepalive,
    })
    showCustomizer.value = false
    showToast('Configuration applied for this session', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

const handleDownload = async (server) => {
  try {
    await downloadConfig(server)
    showToast('Configuration downloaded', 'success')
  } catch (err) {
    showToast('Download failed', 'error')
  }
}

const handleCopy = async (server) => {
  try {
    await copyConfig(server)
    showToast('Configuration copied', 'success')
  } catch (err) {
    showToast('Copy failed', 'error')
  }
}

const handleShowQrCode = (server) => {
  handleShowQR(server, () => apiService.generateQR(prepareConfig(server)))
    .catch(() => showToast('Failed to generate QR code', 'error'))
}

onMounted(async () => {
  try {
    window.scrollTo(0, 0)
    await Promise.all([loadServers(), loadPersistedSettings()])

    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isLoading.value) {
        loadMoreServers()
      }
    }, { rootMargin: '200px' })

    reobserveSentinel()
    window.addEventListener('scroll', handleUiScroll, { passive: true })
  } catch (err) {
    showToast(err.message || 'Unable to load application data', 'error')
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  window.removeEventListener('scroll', handleUiScroll)
  cleanupQrCodeUrl()
})

watch([filterCountry, filterCity], reobserveSentinel)
</script>

<template>
  <Toast v-if="toast" v-bind="toast" @close="toast = null" />

  <div v-if="showQrCode" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click="showQrCode = false" role="dialog" aria-modal="true">
    <div class="fixed inset-0 bg-nord-bg-overlay" />
    <div class="relative bg-vscode-bg rounded-lg border border-vscode-active overflow-hidden max-w-sm w-full" @click.stop>
      <div class="bg-nord-bg-overlay-light px-3 py-1.5 text-xs font-medium border-b border-vscode-active flex items-center justify-between text-nord-text-primary">
        <span>{{ selectedServer?.name }}</span>
        <button @click="showQrCode = false" class="p-1 rounded border border-transparent hover:bg-nord-bg-hover" aria-label="Close QR code dialog">
          <Icon name="close" class="w-3.5 h-3.5" />
        </button>
      </div>
      <div class="p-6 flex justify-center">
        <img :src="qrCodeUrl" :alt="`WireGuard QR Code for ${selectedServer?.name}`" class="w-[200px] h-[200px] rounded">
      </div>
    </div>
  </div>

  <KeyGenerator v-if="showKeyGenerator" @generate="handleGenerateKey" @cancel="showKeyGenerator = false" />

  <ConfigCustomizer
    v-if="showCustomizer"
    :session-private-key="sessionPrivateKey"
    :persisted-settings="persistedSettings"
    :default-settings="defaultSettings"
    @apply="handleApplyConfig"
    @cancel="showCustomizer = false"
  />

  <div v-show="isMainViewVisible" class="min-h-screen bg-vscode-bg text-vscode-text">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active" role="banner">
      <h1 class="sr-only">NordVPN WireGuard Config Generator</h1>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-2">
        <nav class="flex items-center gap-2 flex-1" role="navigation" aria-label="Main navigation">
          <button @click="togglePanel" class="shrink-0 p-2 flex items-center justify-center border border-transparent md:hover:bg-nord-bg-hover rounded-md" aria-label="Toggle navigation menu">
            <Icon name="menu" class="w-5 h-5" />
          </button>
          <div class="flex gap-2 w-full sm:w-auto overflow-hidden" @click="closePanel">
            <select v-model="filterCountry" class="bg-vscode-bg border border-vscode-active rounded px-2 py-1.5 text-sm transition-[width] duration-200 [will-change:width]" :class="{ 'w-full sm:w-[200px]': !filterCountry, 'w-[45%] sm:w-[200px]': filterCountry }" aria-label="Filter by country">
              <option value="">All Countries</option>
              <option v-for="country in countries" :key="country" :value="country">{{ formatDisplayName(country) }}</option>
            </select>
            <div class="transition-[width,opacity] duration-200 [will-change:width,opacity]" :class="filterCountry ? 'w-[55%] sm:w-[200px] opacity-100' : 'w-0 opacity-0'">
              <select v-model="filterCity" :disabled="citiesForCountry.length < 2" class="w-full bg-vscode-bg border border-vscode-active rounded px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:border-nord-text-secondary/30" aria-label="Filter by city">
                <option v-if="citiesForCountry.length > 1" value="">All Cities</option>
                <option v-for="city in citiesForCountry" :key="city" :value="city">{{ formatDisplayName(city) }}</option>
              </select>
            </div>
          </div>
        </nav>
        <div class="flex items-center justify-end gap-2 text-xs" @click="closePanel" role="group" aria-label="Sort controls">
          <button @click="toggleSort('load')" class="flex items-center gap-1 min-w-[80px] px-3 py-1.5 rounded border md:hover:bg-nord-bg-hover font-semibold" :class="sortBy === 'load' ? 'bg-nord-bg-active border-vscode-accent text-white' : 'border-vscode-active'" :aria-pressed="sortBy === 'load'">
            <span>Load</span>
            <Icon v-if="sortBy === 'load'" :name="sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" class="w-4 h-4" />
          </button>
          <button @click="toggleSort('name')" class="flex items-center gap-1 min-w-[80px] px-3 py-1.5 rounded border md:hover:bg-nord-bg-hover font-semibold" :class="sortBy === 'name' ? 'bg-nord-bg-active border-vscode-accent text-white' : 'border-vscode-active'" :aria-pressed="sortBy === 'name'">
            <span>A-Z</span>
            <Icon v-if="sortBy === 'name'" :name="sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" class="w-4 h-4" />
          </button>
          <div class="px-3 py-1.5 rounded bg-vscode-bg/50 border border-vscode-active/50" role="status" aria-live="polite">
            <span class="text-xs text-nord-text-secondary font-semibold">{{ filteredCount }} servers</span>
          </div>
        </div>
      </div>
    </header>

    <div class="fixed inset-0 bg-nord-bg-overlay/30 z-30 transition-opacity duration-150 [will-change:opacity]" :class="isPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'" @click="closePanel" />
    <aside class="fixed inset-y-0 left-0 w-64 bg-vscode-header border-r border-vscode-active z-40 transition-transform duration-150 flex flex-col [will-change:transform]" :class="isPanelOpen ? 'translate-x-0' : '-translate-x-full'" role="complementary">
      <div class="h-[115px] sm:h-14 bg-vscode-header" />
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        <button @click="openCustomizer" class="w-full px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-sm md:hover:bg-nord-bg-hover transition-colors">
          <div class="flex items-center gap-2">
            <Icon name="settings" class="w-4 h-4 text-vscode-accent" />
            <span>Customize Config</span>
          </div>
        </button>
        <button @click="openKeyGenerator" class="w-full px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-sm md:hover:bg-nord-bg-hover transition-colors">
          <div class="flex items-center gap-2">
            <Icon name="key" class="w-4 h-4 text-vscode-accent" />
            <span>Generate Key</span>
          </div>
        </button>
        <label class="flex items-center justify-between cursor-pointer group mt-4">
          <span class="text-sm font-medium text-nord-text-primary">Show Server IP</span>
          <button type="button" @click="showServerIp = !showServerIp" class="relative w-10 h-5 rounded-full transition-colors [will-change:background-color]" :class="showServerIp ? 'bg-nord-button-primary' : 'bg-nord-button-secondary'" :aria-pressed="String(showServerIp)" aria-label="Toggle server IP visibility">
            <span class="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform [will-change:transform]" :class="{ 'translate-x-[18px]': showServerIp }" />
          </button>
        </label>
      </div>
      <div class="p-4 space-y-3 border-t border-vscode-active bg-nord-bg-overlay/20">
        <a href="https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator" target="_blank" rel="noopener" class="block w-full px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-sm md:hover:bg-nord-bg-hover transition-colors">
          <div class="flex items-center gap-2">
            <Icon name="github" class="w-4 h-4 text-vscode-accent" />
            <span>Star on GitHub</span>
          </div>
        </a>
        <a href="https://refer-nordvpn.com/MXIVDoJGpKT" target="_blank" rel="noopener" class="block w-full px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-sm md:hover:bg-nord-bg-hover transition-colors">
          <div class="flex items-center gap-2">
            <Icon name="externalLink" class="w-4 h-4 text-vscode-accent" />
            <span>Get NordVPN</span>
          </div>
        </a>
      </div>
    </aside>

    <main class="container mx-auto px-4 py-6" role="main" aria-live="polite">
      <h2 class="sr-only">Available Servers</h2>
      <div v-if="visibleServers.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mx-auto">
        <ServerCard
          v-for="server in visibleServers"
          v-memo="[server, showServerIp]"
          :key="server.name"
          :server="server"
          :show-ip="showServerIp"
          @download="handleDownload(server)"
          @copy="handleCopy(server)"
          @show-qr="handleShowQrCode(server)"
          @copy-ip="showToast('IP copied', 'success')"
        />
      </div>
      <div v-else-if="!isLoading" class="text-center py-20">
        <Icon name="error" class="w-12 h-12 mx-auto text-nord-text-secondary/50 mb-4" />
        <p class="text-nord-text-secondary font-medium">{{ emptyStateMessage }}</p>
      </div>
      <div ref="sentinel" class="h-10" />
      <div v-if="isLoading" class="flex justify-center py-4">
        <div class="w-6 h-6 border-2 border-vscode-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </main>

    <button v-show="showScrollTopButton" @click="scrollToTop" class="fixed bottom-4 right-4 p-2 rounded-full bg-vscode-header/90 border border-vscode-accent z-50 hover:bg-vscode-header" aria-label="Scroll to top">
      <Icon name="arrowUp" class="w-5 h-5" />
    </button>
  </div>
</template>