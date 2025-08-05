import { ref, toRefs, watch } from 'vue'
import { storageService } from '@/services/storageService'

const PANEL_TOGGLE_DEBOUNCE_MS = 200
const SMOOTH_SCROLL_OPTIONS = { top: 0, behavior: 'smooth' }
const MODAL_TYPES = {
  CUSTOMIZER: 'showCustomizer',
  KEY_GENERATOR: 'showKeyGenerator',
  QR_CODE: 'showQrCode'
}

export function useUI() {
  const isServerIpVisibleOnLoad = storageService.get('showServerIp') === true
  const state = ref({
    isPanelOpen: false,
    isPanelToggleDebouncing: false,
    showScrollTopButton: false,
    showServerIp: isServerIpVisibleOnLoad,
    [MODAL_TYPES.CUSTOMIZER]: false,
    [MODAL_TYPES.KEY_GENERATOR]: false,
    [MODAL_TYPES.QR_CODE]: false,
    qrCodeUrl: '',
    selectedServer: null
  })

  const stateAsRefs = toRefs(state.value)

  watch(stateAsRefs.showServerIp, (isNowVisible) => {
    storageService.set('showServerIp', isNowVisible)
  })

  const closePanel = () => {
    if (state.value.isPanelOpen) {
      state.value.isPanelOpen = false
    }
  }

  const togglePanel = () => {
    if (state.value.isPanelToggleDebouncing) return
    state.value.isPanelToggleDebouncing = true
    state.value.isPanelOpen = !state.value.isPanelOpen
    setTimeout(() => {
      state.value.isPanelToggleDebouncing = false
    }, PANEL_TOGGLE_DEBOUNCE_MS)
  }

  const openModal = (modalType) => {
    closePanel()
    Object.values(MODAL_TYPES).forEach(modal => {
      state.value[modal] = modal === modalType
    })
  }

  const handleShowQR = async (server, qrCodeGenerator) => {
    try {
      state.value.selectedServer = server
      if (state.value.qrCodeUrl) {
        URL.revokeObjectURL(state.value.qrCodeUrl)
      }
      const qrBlob = await qrCodeGenerator()
      state.value.qrCodeUrl = URL.createObjectURL(qrBlob)
      openModal(MODAL_TYPES.QR_CODE)
    } catch (err) {
      state.value[MODAL_TYPES.QR_CODE] = false
      throw err
    }
  }

  const cleanupQrCodeUrl = () => {
    if (state.value.qrCodeUrl) {
      URL.revokeObjectURL(state.value.qrCodeUrl)
    }
  }

  return {
    ...stateAsRefs,
    closePanel,
    togglePanel,
    scrollToTop: () => window.scrollTo(SMOOTH_SCROLL_OPTIONS),
    openCustomizer: () => openModal(MODAL_TYPES.CUSTOMIZER),
    openKeyGenerator: () => openModal(MODAL_TYPES.KEY_GENERATOR),
    handleShowQR,
    cleanupQrCodeUrl
  }
}