import { ref } from 'vue'

const MAX_MESSAGE_LENGTH = 100
const ALLOWED_TYPES = new Set(['success', 'error'])

let instance = null
let nextToastId = 0

export function useToast() {
  if (instance) return instance

  const toast = ref(null)

  const show = (message, type = 'success') => {
    if (!message) return

    const normalizedMessage = (message instanceof Error ? message.message : String(message))
      .split('\n')[0]
      .slice(0, MAX_MESSAGE_LENGTH)

    toast.value = {
      id: ++nextToastId,
      message: normalizedMessage,
      type: ALLOWED_TYPES.has(type) ? type : 'success',
    }
  }

  instance = { toast, show }
  return instance
}