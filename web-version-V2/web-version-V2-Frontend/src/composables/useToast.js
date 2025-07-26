import { ref } from 'vue'

// Constants
const TOAST_DURATION = 2000
const MESSAGE_MAX_LENGTH = 100

// Toast types mapped to theme colors
const TOAST_STYLES = {
  success: {
    bg: 'bg-nord-success-bg',
    text: 'text-nord-success-text',
    border: 'border-nord-success-text/20',
    shadow: 'shadow-nord-success-text/10'
  },
  error: {
    bg: 'bg-nord-load-critical-bg',
    text: 'text-nord-load-critical-text',
    border: 'border-nord-load-critical-text/20',
    shadow: 'shadow-nord-load-critical-text/10'
  },
  info: {
    bg: 'bg-nord-bg-overlay',
    text: 'text-nord-text-primary',
    border: 'border-nord-text-primary/20',
    shadow: 'shadow-nord-text-primary/10'
  }
}

/**
 * Composable for managing toast notifications
 * @returns {Object} Toast state and methods
 */
export function useToast() {
  const toast = ref(null)
  let timeout

  const show = (message, type = 'info') => {
    if (!message) return

    // Format message
    const displayMessage = message instanceof Error 
      ? message.message.split('\n')[0]
      : String(message).slice(0, MESSAGE_MAX_LENGTH)

    // Update toast
    clearTimeout(timeout)
    toast.value = { 
      message: displayMessage, 
      type,
      styles: TOAST_STYLES[type] || TOAST_STYLES.info
    }
    timeout = setTimeout(() => toast.value = null, TOAST_DURATION)
  }

  const clear = () => {
    clearTimeout(timeout)
    toast.value = null
  }

  return { toast, show, clear }
} 