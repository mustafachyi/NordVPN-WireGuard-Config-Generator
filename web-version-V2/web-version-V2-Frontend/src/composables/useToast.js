import { ref } from 'vue'

const TOAST_DISPLAY_DURATION_MS = 2000
const MESSAGE_MAX_LENGTH = 100

export function useToast() {
  const toast = ref(null)
  let activeTimeout = null

  const show = (message, type = 'success') => {
    if (!message) return

    const displayMessage = message instanceof Error
      ? message.message.split('\n')[0].slice(0, MESSAGE_MAX_LENGTH)
      : String(message).slice(0, MESSAGE_MAX_LENGTH)

    clearTimeout(activeTimeout)
    toast.value = {
      message: displayMessage,
      type: ['success', 'error'].includes(type) ? type : 'success',
    }
    activeTimeout = setTimeout(() => {
      toast.value = null
    }, TOAST_DISPLAY_DURATION_MS)
  }

  return { toast, show }
}