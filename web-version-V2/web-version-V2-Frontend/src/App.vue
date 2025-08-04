<script setup>
import { onMounted, onUnmounted, watch, ref } from 'vue'
import { useServers } from './composables/useServers'
import { useConfig, prepareConfig } from './composables/useConfig'
import { useUI } from './composables/useUI'
import { useToast } from './composables/useToast'
import { formatDisplayName, debounce } from './utils/utils'
import { apiService } from './services/apiService'
import ServerCard from './components/ServerCard.vue'
import Toast from './components/Toast.vue'
import Icon from './components/Icon.vue'
import ConfigCustomizer from './components/ConfigCustomizer.vue'
import KeyGenerator from './components/KeyGenerator.vue'

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
  configSettings,
  defaultConfig,
  loadSavedConfig,
  saveConfig,
  downloadConfig,
  copyConfig,
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

watch(filterCountry, (newCountry) => {
  filterCity.value = !newCountry ? '' :
    citiesForCountry.value.length === 1 ? citiesForCountry.value[0] : ''
})

const handleUiScroll = debounce(() => {
  showScrollTopButton.value = window.scrollY > 500
}, 150)

const handleGenerateAndSaveKey = async (token) => {
  try {
    const { key } = await apiService.generateKey(token)
    await saveConfig({ ...configSettings.value, privateKey: key })
    showKeyGenerator.value = false
    showToast('Private key generated and saved', 'success')
  } catch (err) {
    const message = err.status === 401 ? 'The provided token is invalid' : 'Key generation failed'
    showToast(message, 'error')
  }
}

const handleSaveConfig = async (config) => {
  try {
    await saveConfig(config)
    showCustomizer.value = false
    showToast('Configuration saved', 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

const handleDownloadConfig = async (server) => {
  try {
    await downloadConfig(server)
    showToast('Configuration downloaded', 'success')
  } catch (err) {
    showToast('Download failed', 'error')
  }
}

const handleCopyConfig = async (server) => {
  try {
    await copyConfig(server)
    showToast('Configuration copied', 'success')
  } catch (err) {
    showToast('Copy failed', 'error')
  }
}

onMounted(async () => {
  try {
    window.scrollTo(0, 0)
    await Promise.all([loadServers(), loadSavedConfig()])

    observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && !isLoading.value) {
        loadMoreServers()
      }
    })

    if (sentinel.value) {
      observer.observe(sentinel.value)
    }
    
    window.addEventListener('scroll', handleUiScroll, { passive: true })
  } catch (err) {
    showToast(err.message || 'Unable to load application data', 'error')
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
  }
  window.removeEventListener('scroll', handleUiScroll, { passive: true })
  cleanupQrCodeUrl()
})
</script>

<template>
  <Toast v-if="toast" v-bind="toast" @close="toast = null" />

  <div v-if="showQrCode" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click="showQrCode = false" role="dialog" aria-modal="true" aria-labelledby="qr-dialog-title">
    <div class="fixed inset-0 bg-nord-bg-overlay/50 backdrop-blur-sm" />
    <div class="relative bg-vscode-bg rounded-lg border border-vscode-active overflow-hidden max-w-sm w-full qr-dialog" @click.stop>
      <div class="bg-nord-bg-overlay-light px-3 py-1.5 text-xs font-medium border-b border-vscode-active flex items-center justify-between text-nord-text-primary">
        <span id="qr-dialog-title">{{ selectedServer?.name }}</span>
        <button @click="showQrCode = false" class="p-1 rounded hover:bg-nord-bg-hover" aria-label="Close QR code dialog">
          <Icon name="close" class="w-3.5 h-3.5" />
        </button>
      </div>
      <div class="p-6 flex justify-center">
        <img :src="qrCodeUrl" :alt="'WireGuard Configuration QR Code for server ' + selectedServer?.name" class="w-[200px] h-[200px] rounded">
      </div>
    </div>
  </div>

  <KeyGenerator v-show="showKeyGenerator" @generate="handleGenerateAndSaveKey" @cancel="showKeyGenerator = false" />

  <ConfigCustomizer v-show="showCustomizer" :defaultConfig="defaultConfig" :savedConfig="configSettings" @save="handleSaveConfig" @cancel="showCustomizer = false" />

  <div v-show="!showKeyGenerator && !showCustomizer" class="min-h-screen bg-vscode-bg text-vscode-text">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active shadow-lg" role="banner">
      <h1 class="sr-only">NordVPN WireGuard Config Generator</h1>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-2">
        <nav class="flex items-center gap-2 flex-1" role="navigation" aria-label="Main navigation">
          <button @click="togglePanel" class="shrink-0 min-w-touch min-h-touch p-2 flex items-center justify-center touch-manipulation focus:outline-none md:hover:bg-nord-bg-hover" aria-label="Toggle navigation menu">
            <Icon name="menu" class="w-5 h-5" />
          </button>
          <div class="flex gap-2 w-full sm:w-auto overflow-hidden" @click="closePanel">
            <select v-model="filterCountry" class="bg-vscode-bg border border-vscode-active rounded px-2 py-1.5 text-sm touch-pan-y transition-all duration-200" :class="{ 'w-full sm:w-[200px]': !filterCountry, 'w-[45%] sm:w-[200px]': filterCountry }" aria-label="Filter by country">
              <option value="">All Countries</option>
              <option v-for="country in countries" :key="country" :value="country">{{ formatDisplayName(country) }}</option>
            </select>
            <div class="overflow-hidden transition-[width] duration-200" :class="filterCountry ? 'w-[55%] sm:w-[200px]' : 'w-0'">
              <select v-model="filterCity" :disabled="citiesForCountry.length === 1" class="w-full bg-vscode-bg border border-vscode-active rounded px-2 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:border-nord-text-secondary/30 touch-pan-y" aria-label="Filter by city">
                <option v-if="citiesForCountry.length > 1" value="">All Cities</option>
                <option v-for="city in citiesForCountry" :key="city" :value="city">{{ formatDisplayName(city) }}</option>
              </select>
            </div>
          </div>
        </nav>
        <div class="flex items-center justify-end gap-2 text-xs" @click="closePanel" role="group" aria-label="Sort controls">
          <button @click="toggleSort('load')" class="min-w-[80px] px-3 py-1.5 rounded border border-vscode-active md:hover:bg-nord-bg-hover font-semibold" :class="{ 'bg-nord-load-low-bg text-nord-load-low-text border-nord-load-low-text': sortBy === 'load' && sortOrder === 'asc', 'bg-nord-load-critical-bg text-nord-load-critical-text border-nord-load-critical-text': sortBy === 'load' && sortOrder === 'desc' }" :aria-pressed="sortBy === 'load'" aria-label="Sort by server load">By Load</button>
          <button @click="toggleSort('name')" class="min-w-[80px] px-3 py-1.5 rounded border border-vscode-active md:hover:bg-nord-bg-hover font-semibold" :class="{ 'bg-nord-load-medium-bg text-nord-load-medium-text border-nord-load-medium-text': sortBy === 'name' && sortOrder === 'asc', 'bg-nord-load-warning-bg text-nord-load-warning-text border-nord-load-warning-text': sortBy === 'name' && sortOrder === 'desc' }" :aria-pressed="sortBy === 'name'" aria-label="Sort alphabetically">A-Z</button>
          <div class="px-3 py-1.5 rounded bg-vscode-bg/50 border border-vscode-active/50" role="status" aria-live="polite">
            <span class="text-xs text-nord-text-secondary font-semibold">{{ filteredCount }} servers</span>
          </div>
        </div>
      </div>
    </header>

    <div class="fixed inset-0 bg-nord-bg-overlay/30 z-30 transition-opacity duration-150" :class="isPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'" @click="closePanel" />

    <aside class="fixed inset-y-0 left-0 w-64 bg-vscode-header border-r border-vscode-active z-40 transition-transform duration-150 flex flex-col" :class="isPanelOpen ? 'translate-x-0' : '-translate-x-full'" role="complementary" aria-label="Settings panel">
      <div class="sticky top-0 h-[115px] sm:h-14 bg-vscode-header" />
      <div class="flex-1 overflow-y-auto">
        <div class="p-4 space-y-3">
          <button @click="openCustomizer" class="w-full min-h-touch px-4 py-2.5 rounded border border-vscode-active bg-nord-bg-overlay/20 text-sm transition-colors relative group overflow-hidden active:scale-[0.98] md:active:scale-100">
            <div class="absolute inset-y-0 left-0 w-1 bg-vscode-accent transform -translate-x-1 md:group-hover:translate-x-0 transition-transform" />
            <div class="flex items-center gap-2">
              <Icon name="settings" class="w-4 h-4 text-vscode-accent" />
              <span>Customize Config</span>
            </div>
          </button>
          <button @click="openKeyGenerator" class="w-full min-h-touch px-4 py-2.5 rounded border border-vscode-active bg-nord-bg-overlay/20 text-sm transition-colors relative group overflow-hidden active:scale-[0.98] md:active:scale-100">
            <div class="absolute inset-y-0 left-0 w-1 bg-vscode-accent transform -translate-x-1 md:group-hover:translate-x-0 transition-transform" />
            <div class="flex items-center gap-2">
              <Icon name="key" class="w-4 h-4 text-vscode-accent" />
              <span>Generate Key</span>
            </div>
          </button>
          <div class="mt-4">
            <label class="flex items-center justify-between cursor-pointer group">
              <span class="text-sm font-medium text-nord-text-primary">Show Server IP</span>
              <button
                type="button"
                @click="showServerIp = !showServerIp"
                class="relative w-10 h-5 rounded-full transition-colors focus:outline-none"
                :class="showServerIp ? 'bg-nord-button-primary hover:bg-nord-button-primary-hover' : 'bg-nord-button-secondary hover:bg-nord-button-secondary-hover'"
                :aria-pressed="String(showServerIp)"
                aria-label="Toggle server IP display"
              >
                <span
                  class="absolute left-0 top-0 w-4 h-4 rounded-full bg-white transition-transform mt-0.5"
                  :class="showServerIp ? 'translate-x-5' : 'translate-x-0.5'"
                ></span>
              </button>
            </label>
          </div>
        </div>
      </div>

      <div class="p-4 space-y-3 border-t border-vscode-active bg-nord-bg-overlay/20">
        <a href="https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator" target="_blank" rel="noopener" class="block px-4 py-2.5 rounded border border-nord-external-github/50 bg-nord-external-github/10 text-sm text-nord-external-github transition-colors relative group overflow-hidden active:scale-[0.98] md:active:scale-100">
          <div class="absolute inset-y-0 left-0 w-1 bg-nord-external-github transform -translate-x-1 md:group-hover:translate-x-0 transition-transform" />
          <div class="flex items-center justify-center gap-2">
            <Icon name="github" class="w-4 h-4" />
            <span>Star on GitHub</span>
          </div>
        </a>
        <a href="https://refer-nordvpn.com/MXIVDoJGpKT" target="_blank" rel="noopener" class="block px-4 py-2.5 rounded border border-nord-external-nord/50 bg-nord-external-nord/10 text-sm text-nord-external-nord transition-colors relative group overflow-hidden active:scale-[0.98] md:active:scale-100">
          <div class="absolute inset-y-0 left-0 w-1 bg-nord-external-nord transform -translate-x-1 md:group-hover:translate-x-0 transition-transform" />
          <div class="flex items-center justify-center gap-2">
            <Icon name="nord" class="w-4 h-4" />
            <span>Get Nord</span>
          </div>
        </a>
      </div>
    </aside>

    <main class="container mx-auto px-4 py-6" role="main">
      <h2 class="sr-only">Available Servers</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mx-auto">
        <ServerCard
          v-for="server in visibleServers"
          :key="server.name"
          v-bind="{
            name: server.displayName,
            country: server.displayCountry,
            city: server.displayCity,
            ip: server.ip,
            showIp: showServerIp,
            load: server.load
          }"
          @download-config="handleDownloadConfig(server)"
          @copy-config="handleCopyConfig(server)"
          @show-qr="handleShowQR(server, () => apiService.generateQR(prepareConfig(server, configSettings)))"
          @copy-ip="() => showToast('IP copied', 'success')"
        />
      </div>
      
      <div ref="sentinel" class="h-10"></div>

      <div v-if="isLoading" class="flex justify-center py-4">
        <div class="w-6 h-6 border-2 border-vscode-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </main>

    <button v-show="showScrollTopButton" @click="scrollToTop" class="fixed bottom-4 right-4 min-w-touch min-h-touch p-2 rounded-full bg-vscode-header/90 backdrop-blur-sm border border-vscode-accent text-vscode-text shadow-lg z-50 md:hover:bg-nord-bg-hover" aria-label="Scroll to top">
      <Icon name="arrowUp" class="w-5 h-5" />
    </button>
  </div>
</template>