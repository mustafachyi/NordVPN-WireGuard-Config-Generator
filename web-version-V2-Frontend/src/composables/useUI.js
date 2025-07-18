import { ref, toRefs, watch } from 'vue'

// Constants
const PANEL_DEBOUNCE = 200
const SCROLL_OPTS = { top: 0, behavior: 'smooth' }
const MODALS = {
  CUSTOMIZER: 'showCustomizer',
  KEY_GENERATOR: 'showKeyGenerator',
  QR_CODE: 'showQrCode'
}

/**
 * Composable for managing UI state and interactions
 * @returns {Object} UI state and methods
 */
export function useUI() {
  // State
  const persisted = localStorage.getItem('showServerIp')
  const state = ref({
    isPanelOpen: false,
    isDebouncing: false,
    showScrollTop: false,
    showServerIp: persisted === 'true',
    [MODALS.CUSTOMIZER]: false,
    [MODALS.KEY_GENERATOR]: false,
    [MODALS.QR_CODE]: false,
    qrCodeUrl: '',
    selectedServer: null
  })

  const {
    isPanelOpen,
    isDebouncing,
    showScrollTop,
    showServerIp,
    showCustomizer,
    showKeyGenerator,
    showQrCode,
    qrCodeUrl,
    selectedServer
  } = toRefs(state.value)

  watch(showServerIp, v => {
    localStorage.setItem('showServerIp', v ? 'true' : 'false')
  })

  // Panel controls
  const closePanel = () => isPanelOpen.value && (isPanelOpen.value = false)

  const togglePanel = () => {
    if (!isDebouncing.value) {
      isDebouncing.value = true
      isPanelOpen.value = !isPanelOpen.value
      setTimeout(() => {
        isDebouncing.value = false
      }, PANEL_DEBOUNCE)
    }
  }

  // Modal controls
  const openModal = (type) => {
    isPanelOpen.value = false
    state.value[type] = true
  }

  const openCustomizer = () => openModal(MODALS.CUSTOMIZER)
  const openKeyGenerator = () => openModal(MODALS.KEY_GENERATOR)

  // Server operations
  const handleGenerateKey = (server) => {
    selectedServer.value = server
    state.value[MODALS.KEY_GENERATOR] = true
  }

  const handleShowQR = async (server, generateQR) => {
    try {
      selectedServer.value = server
      state.value[MODALS.QR_CODE] = true

      if (qrCodeUrl.value) {
        URL.revokeObjectURL(qrCodeUrl.value)
      }
      qrCodeUrl.value = URL.createObjectURL(await generateQR())
    } catch (err) {
      state.value[MODALS.QR_CODE] = false
      throw err
    }
  }

  // Utils
  const scrollToTop = () => window.scrollTo(SCROLL_OPTS)
  const cleanup = () => qrCodeUrl.value && URL.revokeObjectURL(qrCodeUrl.value)

  return {
    // State
    isPanelOpen,
    showScrollTop,
    showServerIp,
    showCustomizer,
    showKeyGenerator,
    showQrCode,
    qrCodeUrl,
    selectedServer,

    // Methods
    closePanel,
    togglePanel,
    scrollToTop,
    openCustomizer,
    openKeyGenerator,
    handleGenerateKey,
    handleShowQR,
    cleanup
  }
} 