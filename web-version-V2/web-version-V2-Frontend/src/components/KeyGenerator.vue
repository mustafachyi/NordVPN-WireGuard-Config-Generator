<script setup>
import { ref } from 'vue'
import { VALIDATION } from '@/utils/utils'
import Icon from '@/components/Icon.vue'

const emit = defineEmits(['generate', 'cancel'])

const token = ref('')
const error = ref('')
const showToken = ref(false)
const isLoading = ref(false)

const validateToken = (value) => {
  return VALIDATION.TOKEN.validate(value) ? '' : VALIDATION.TOKEN.ERROR
}

const handleInput = (event) => {
  token.value = VALIDATION.TOKEN.sanitize(event.target.value)
  error.value = validateToken(token.value)
}

const submitGeneration = async () => {
  const validationError = validateToken(token.value)
  if (validationError || !token.value) {
    error.value = validationError || 'Token is required.'
    return
  }

  isLoading.value = true
  try {
    await emit('generate', token.value)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-vscode-bg text-vscode-text flex flex-col">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active">
      <div class="px-4 h-14 flex items-center">
        <h1 class="text-lg font-medium">Generate Private Key</h1>
      </div>
    </header>

    <main class="flex-1">
      <form @submit.prevent="submitGeneration" class="container mx-auto px-4 py-6 max-w-2xl">
        <p class="text-sm text-nord-text-secondary mb-4">
          Generate a session-only private key with a NordVPN auth token.
          The key is not stored and must be saved securely.
        </p>
        <div>
          <label for="auth-token" class="block text-sm font-medium">Auth Token</label>
          <div class="relative mt-1">
            <input
              id="auth-token"
              :value="token"
              @input="handleInput"
              :type="showToken ? 'text' : 'password'"
              placeholder="64-character hexadecimal token"
              maxlength="64"
              class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm"
              :class="error ? 'border-nord-text-error' : 'border-nord-button-secondary'"
            >
            <button type="button" @click="showToken = !showToken" class="absolute right-2.5 top-2.5" :aria-label="showToken ? 'Hide' : 'Show'">
              <Icon :name="showToken ? 'eye' : 'eyeOff'" class="w-4 h-4"/>
            </button>
          </div>
          <p v-if="error" class="text-xs text-nord-text-error mt-1">{{ error }}</p>
        </div>
      </form>
    </main>

    <footer class="bg-vscode-header border-t border-vscode-active p-4">
      <div class="container mx-auto max-w-2xl flex justify-end gap-3">
        <button
          type="button"
          @click="submitGeneration"
          :disabled="isLoading || !!error || !token"
          class="px-4 py-2 rounded bg-nord-button-primary border border-transparent disabled:opacity-50"
        >
          {{ isLoading ? 'Generating...' : 'Generate' }}
        </button>
        <button type="button" @click="emit('cancel')" class="px-4 py-2 rounded border border-nord-button-secondary">Cancel</button>
      </div>
    </footer>
  </div>
</template>