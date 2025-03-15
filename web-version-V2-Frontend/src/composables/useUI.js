import { ref, toRefs } from 'vue'

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
  const state = ref({
    isPanelOpen: false,
    isDebouncing: false,
    showScrollTop: false,
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
    showCustomizer,
    showKeyGenerator,
    showQrCode,
    qrCodeUrl,
    selectedServer
  } = toRefs(state.value)

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