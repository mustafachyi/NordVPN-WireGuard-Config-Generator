<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { useServers } from './composables/useServers'
import { useConfig, prepareConfig } from './composables/useConfig'
import { useUI } from './composables/useUI'
import { useToast } from './composables/useToast'
import { formatDisplayName, debounce } from './utils/utils'
import { apiService } from './services/apiService'
import ServerCard from './components/ServerCard.vue'
import ConfigCustomizer from './components/ConfigCustomizer.vue'
import KeyGenerator from './components/KeyGenerator.vue'
import Toast from './components/Toast.vue'
import Icon from './components/Icon.vue'

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
  updateVisibleServers,
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
  lastToast
} = useConfig()

const {
  isPanelOpen,
  showScrollTop,
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
  handleGenerateKey,
  handleShowQR,
  cleanup: uiCleanup
} = useUI()

const { toast, show: showToast } = useToast()

// Watch for filter changes
watch([sortBy, sortOrder, filterCountry, filterCity], updateVisibleServers)

// Watch for country changes to reset city when needed
watch(filterCountry, (newCountry) => {
  filterCity.value = !newCountry ? '' : 
    citiesForCountry.value.length === 1 ? citiesForCountry.value[0] : ''
})

// Watch for config toast notifications
watch(lastToast, ({ message, type } = {}) => 
  message && showToast(message, type || 'info')
)

// Handle scroll for infinite loading
const handleScroll = debounce(() => {
  const { innerHeight, scrollY } = window
  const { offsetHeight } = document.documentElement
  scrollY > offsetHeight - innerHeight - 1000 && loadMoreServers()
  showScrollTop.value = scrollY > 500
}, 100)

// Handle config customization
const handleConfig = async (action, params = {}) => {
  const actions = {
    saveKey: async () => {
      const { key } = params
      if (!key?.trim()) throw new Error('Invalid key provided')
      await saveConfig({ ...defaultConfig, ...configSettings.value, privateKey: key.trim() })
      showKeyGenerator.value = false
      return 'Private key saved successfully'
    },
    saveConfig: async () => {
      const { config } = params
      if (!config) throw new Error('Invalid configuration')
      await saveConfig(config)
      showCustomizer.value = false
      return 'Configuration saved'
    },
    download: async () => {
      const { server } = params
      if (!server) throw new Error('No server selected')
      await downloadConfig(server)
      return 'Configuration downloaded'
    },
    copy: async () => {
      const { server } = params
      if (!server) throw new Error('No server selected')
      await copyConfig(server)
      return 'Configuration copied'
    }
  }

  try {
    showToast(await actions[action](), 'success')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

onMounted(async () => {
  try {
    // Ensure page starts at top
    window.scrollTo(0, 0)
    await Promise.all([loadServers(), loadSavedConfig()])
    window.addEventListener('scroll', handleScroll)
  } catch {
    showToast('Unable to load application data', 'error')
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  uiCleanup()
})
</script>

<template>
  <!-- Toast notifications -->
  <Toast v-if="toast" v-bind="toast" @close="toast = null" />

  <!-- QR Code Modal -->
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
  
  <!-- Key Generator -->
  <KeyGenerator v-if="showKeyGenerator" @save="key => handleConfig('saveKey', { key })" @cancel="showKeyGenerator = false" @toast="({ message, type }) => showToast(message, type)" />

  <!-- Config Customizer -->
  <ConfigCustomizer v-else-if="showCustomizer" :defaultConfig="defaultConfig" :savedConfig="configSettings" @save="config => handleConfig('saveConfig', { config })" @cancel="showCustomizer = false" @toast="({ message, type }) => showToast(message, type)" />

  <!-- Main App -->
  <div v-else class="min-h-screen bg-vscode-bg text-vscode-text">
    <!-- Header -->
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active shadow-lg" role="banner">
      <h1 class="sr-only">NordVPN WireGuard Config Generator</h1>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-2">
        <!-- Navigation -->
        <nav class="flex items-center gap-2 flex-1" role="navigation" aria-label="Main navigation">
          <button @click="togglePanel" @touchstart.prevent="togglePanel" class="shrink-0 min-w-touch min-h-touch p-2 flex items-center justify-center touch-manipulation focus:outline-none md:hover:bg-nord-bg-hover" aria-label="Toggle navigation menu">
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
        <!-- Sort Controls -->
        <div class="flex items-center justify-end gap-2 text-xs" @click="closePanel" role="group" aria-label="Sort controls">
          <button @click="toggleSort('load')" class="min-w-[80px] px-3 py-1.5 rounded border border-vscode-active md:hover:bg-nord-bg-hover font-semibold" :class="{ 'bg-nord-load-low-bg text-nord-load-low-text border-nord-load-low-text': sortBy === 'load' && sortOrder === 'asc', 'bg-nord-load-critical-bg text-nord-load-critical-text border-nord-load-critical-text': sortBy === 'load' && sortOrder === 'desc' }" :aria-pressed="sortBy === 'load'" aria-label="Sort by server load">By Load</button>
          <button @click="toggleSort('name')" class="min-w-[80px] px-3 py-1.5 rounded border border-vscode-active md:hover:bg-nord-bg-hover font-semibold" :class="{ 'bg-nord-load-medium-bg text-nord-load-medium-text border-nord-load-medium-text': sortBy === 'name' && sortOrder === 'asc', 'bg-nord-load-warning-bg text-nord-load-warning-text border-nord-load-warning-text': sortBy === 'name' && sortOrder === 'desc' }" :aria-pressed="sortBy === 'name'" aria-label="Sort alphabetically">A-Z</button>
          <div class="px-3 py-1.5 rounded bg-vscode-bg/50 border border-vscode-active/50" role="status" aria-live="polite">
            <span class="text-xs text-nord-text-secondary font-semibold">{{ filteredCount }} servers</span>
          </div>
        </div>
      </div>
    </header>

    <!-- Side Panel Overlay -->
    <div class="fixed inset-0 bg-nord-bg-overlay/30 z-30 transition-opacity duration-150" :class="isPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'" @click="closePanel" />

    <!-- Side Panel -->
    <aside class="fixed inset-y-0 left-0 w-64 bg-vscode-header border-r border-vscode-active z-40 transition-transform duration-150 flex flex-col" :class="isPanelOpen ? 'translate-x-0' : '-translate-x-full'" role="complementary" aria-label="Settings panel">
      <!-- Header Spacer -->
      <div class="sticky top-0 h-[115px] sm:h-14 bg-vscode-header" />
      
      <!-- Panel Content -->
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
        </div>
      </div>

      <!-- Footer Links -->
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

    <!-- Main Content -->
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
            load: server.load 
          }" 
          @generate-key="handleGenerateKey(server)" 
          @download-config="handleConfig('download', { server })" 
          @copy-config="handleConfig('copy', { server })" 
          @show-qr="handleShowQR(server, () => apiService.generateQR(prepareConfig(server, configSettings)))" 
        />
      </div>
      <div v-if="isLoading" class="flex justify-center py-4">
        <div class="w-6 h-6 border-2 border-vscode-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </main>

    <!-- Scroll to Top -->
    <button v-show="showScrollTop" @click="scrollToTop" class="fixed bottom-4 right-4 min-w-touch min-h-touch p-2 rounded-full bg-vscode-header/90 backdrop-blur-sm border border-vscode-accent text-vscode-text shadow-lg z-50 md:hover:bg-nord-bg-hover" aria-label="Scroll to top">
      <Icon name="arrowUp" class="w-5 h-5" />
    </button>
  </div>
</template>

<style scoped>
</style>
