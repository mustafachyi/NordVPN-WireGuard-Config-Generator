import { reactive, toRefs, watch } from 'vue'
import { storage } from '@/services/storageService'

let instance = null

export function useUI() {
  if (instance) return instance

  const state = reactive({
    panel: false,
    topButtonVisible: false,
    headerHeight: 0,
    showIp: storage.get('showIp') === true,
    modals: { custom: false, key: false, qr: false },
    qrUrl: '',
    selectedServer: null,
  })

  watch(() => state.showIp, value => storage.set('showIp', value))

  const closePanel = () => {
    state.panel = false
  }

  const closeQr = () => {
    state.modals.qr = false
    state.selectedServer = null

    if (state.qrUrl) {
      URL.revokeObjectURL(state.qrUrl)
      state.qrUrl = ''
    }
  }

  const openModal = modal => {
    closePanel()
    closeQr()

    Object.keys(state.modals).forEach(key => {
      state.modals[key] = key === modal
    })
  }

  const showQr = async (server, createBlob) => {
    const url = URL.createObjectURL(await createBlob())
    closeQr()
    state.selectedServer = server
    state.qrUrl = url
    state.modals.qr = true
  }

  instance = {
    ...toRefs(state),
    close: closePanel,
    closeQr,
    toggle: () => {
      state.panel = !state.panel
    },
    scrollToTop: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    openCustomizer: () => openModal('custom'),
    openKeyGenerator: () => openModal('key'),
    showQr,
  }

  return instance
}