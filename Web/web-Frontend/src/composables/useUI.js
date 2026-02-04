import { reactive, toRefs, watch } from 'vue'
import { storage } from '@/services/storageService'

export function useUI() {
  const state = reactive({
    panel: false,
    topBtn: false,
    showIp: storage.get('showIp') === true,
    modals: { custom: false, key: false, qr: false },
    qrUrl: '',
    server: null
  })

  watch(() => state.showIp, v => storage.set('showIp', v))

  const close = () => state.panel = false
  const open = m => { close(); Object.keys(state.modals).forEach(k => state.modals[k] = k === m) }
  
  const cleanQR = () => { if (state.qrUrl) URL.revokeObjectURL(state.qrUrl) }

  return {
    ...toRefs(state),
    close,
    toggle: () => state.panel = !state.panel,
    top: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    openCustom: () => open('custom'),
    openKey: () => open('key'),
    cleanQR,
    showQR: async (s, fn) => {
      state.server = s
      cleanQR()
      try {
        state.qrUrl = URL.createObjectURL(await fn())
        open('qr')
      } catch (e) {
        state.modals.qr = false
        throw e
      }
    }
  }
}