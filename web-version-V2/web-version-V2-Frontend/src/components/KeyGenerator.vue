<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { apiService } from '../services/apiService'
import { VALIDATION } from '../utils/utils'
import { icons } from '../utils/icons'

// Constants for timing and validation
const DELAYS = { DEBOUNCE: 300 }

// Define component emits
const emit = defineEmits(['save', 'cancel'])

const ERROR_MESSAGES = {
  INVALID_TOKEN: 'Invalid token format. Must be 64 hexadecimal characters.',
  INVALID_TOKEN_API: 'Invalid token. The token you provided is not valid.',
  CONNECTION: 'Failed to connect to the server. Please try again.',
  EMPTY_TOKEN: 'Please enter a token',
  INVALID_KEY: 'Invalid key received from server'
}

// Core state
const state = ref({
  error: '',
  isLoading: false,
  token: '',
  debouncedToken: '',
  inputToken: '',
  showToken: false,
  showResult: false
})

// Input validation
const tokenError = computed(() => {
  if (!state.value.debouncedToken) return ''
  const token = state.value.debouncedToken
  return token.length !== 64 
    ? 'Token must be exactly 64 characters long'
    : !VALIDATION.TOKEN.REGEX.test(token)
      ? 'Token must contain only hexadecimal characters (0-9, a-f)'
      : ''
})

// Event handling
let debounceTimeout
const updateToken = (event) => {
  const input = event.target.value
  const cursorPosition = event.target.selectionStart
  const sanitized = VALIDATION.TOKEN.sanitize(input)
  state.value.inputToken = sanitized
  
  requestAnimationFrame(() => {
    event.target.value = sanitized
    event.target.setSelectionRange(cursorPosition, cursorPosition)
  })
  
  clearTimeout(debounceTimeout)
  debounceTimeout = setTimeout(() => {
    state.value.debouncedToken = state.value.token = sanitized
  }, DELAYS.DEBOUNCE)
}

const handlePaste = (e) => {
  e.preventDefault()
  const sanitized = VALIDATION.TOKEN.sanitize(e.clipboardData.getData('text'))
  Object.assign(state.value, { 
    inputToken: sanitized, 
    debouncedToken: sanitized, 
    token: sanitized 
  })
}

// Key generation
const generateKey = async () => {
  if (!VALIDATION.TOKEN.REGEX.test(state.value.token)) {
    state.value.error = ERROR_MESSAGES.INVALID_TOKEN
    return null
  }

  try {
    state.value.isLoading = true
    state.value.error = ''
    const { key } = await apiService.generateKey(state.value.token)
    
    if (!key?.length || key.length < 32) {
      throw new Error(ERROR_MESSAGES.INVALID_KEY)
    }
    
    state.value.showResult = true
    return key
  } catch (err) {
    state.value.showResult = true
    state.value.error = err.status === 401 
      ? ERROR_MESSAGES.INVALID_TOKEN_API 
      : ERROR_MESSAGES.CONNECTION
    return null
  } finally {
    state.value.isLoading = false
  }
}

const handleGenerate = async () => {
  if (!state.value.token) {
    state.value.error = ERROR_MESSAGES.EMPTY_TOKEN
    return
  }
  
  const key = await generateKey()
  if (key) emit('save', key)
}

// Cleanup
onBeforeUnmount(() => clearTimeout(debounceTimeout))
</script>

<template>
  <div class="min-h-[100dvh] bg-vscode-bg text-vscode-text flex flex-col">
    <!-- Header -->
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active shadow-lg">
      <div class="px-6 h-14 flex items-center">
        <h1 class="text-lg font-medium">Generate Private Key</h1>
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-auto">
      <div class="container mx-auto p-6 max-w-2xl">
        <!-- Token Input -->
        <div v-if="!state.showResult" class="space-y-4">
          <div class="space-y-2">
            <label for="auth-token" class="block text-base font-medium text-nord-text-primary">Auth Token</label>
            <div class="relative">
              <input 
                id="auth-token"
                :value="state.inputToken"
                @input="updateToken"
                @paste="handlePaste"
                @keypress="e => {
                  if (!/^[a-fA-F0-9]$/.test(e.key) || 
                      (state.inputToken.length >= 64 && 
                       e.target.selectionStart === e.target.selectionEnd)) {
                    e.preventDefault()
                  }
                }"
                maxlength="64"
                :type="state.showToken ? 'text' : 'password'"
                placeholder="token"
                :class="[
                  'h-11 w-full bg-vscode-bg border rounded px-4 pr-12 outline-none transition-colors text-sm',
                  state.debouncedToken && (tokenError || state.error)
                    ? 'border-nord-text-error focus:border-nord-text-error focus:ring-2 focus:ring-nord-ring-error/30 text-nord-text-error'
                    : 'border-nord-button-secondary focus:border-nord-button-primary focus:ring-2 focus:ring-nord-ring-primary/30 text-nord-text-primary'
                ]"
                :aria-invalid="!!(state.debouncedToken && (tokenError || state.error))"
                :aria-describedby="state.debouncedToken && (tokenError || state.error) ? 'token-error' : undefined"
              >
              <button
                type="button"
                @click="state.showToken = !state.showToken"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-nord-text-primary/70 hover:text-nord-text-primary transition-colors outline-none"
                :aria-label="state.showToken ? 'Hide token' : 'Show token'"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" role="img" aria-hidden="true">
                  <path fill="currentColor" :d="state.showToken ? icons.eye : icons.eyeOff"/>
                </svg>
              </button>
            </div>
            <p v-if="state.debouncedToken && (tokenError || state.error)" id="token-error" class="text-sm text-nord-text-error" role="alert">
              {{ tokenError || state.error }}
            </p>
          </div>
        </div>

        <!-- Result Terminal -->
        <div v-else class="bg-vscode-bg rounded-lg border border-vscode-active overflow-hidden">
          <div class="bg-black/30 px-4 py-2 text-sm font-medium border-b border-vscode-active">Terminal</div>
          <div class="p-4 font-mono text-base">
            <div v-if="state.error" class="text-nord-text-error font-medium">
              Error: {{ state.error }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="bg-vscode-header border-t border-vscode-active p-4">
      <div class="container mx-auto max-w-2xl flex justify-end gap-3">
        <button 
          v-if="!state.showResult"
          type="button"
          @click="handleGenerate"
          :disabled="state.isLoading || !state.token || !!tokenError"
          class="min-w-touch min-h-touch px-4 py-2 rounded transition-colors focus:outline-none focus:ring-2 text-white"
          :class="state.isLoading || !state.token || tokenError
            ? 'bg-nord-button-primary/40 cursor-not-allowed'
            : 'bg-nord-button-primary hover:bg-nord-button-primary-hover focus:ring-nord-ring-primary/50'"
        >
          Generate
        </button>
        <button 
          @click="$emit('cancel')"
          class="min-w-touch min-h-touch px-4 py-2 rounded transition-colors focus:outline-none focus:ring-2 border border-nord-button-secondary hover:bg-nord-bg-hover focus:ring-nord-ring-secondary/50"
        >
          {{ state.showResult ? 'Close' : 'Cancel' }}
        </button>
      </div>
    </div>
  </div>
</template>
