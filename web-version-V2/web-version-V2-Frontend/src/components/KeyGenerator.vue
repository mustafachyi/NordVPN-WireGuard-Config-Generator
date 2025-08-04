<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { VALIDATION } from '../utils/utils'
import Icon from './Icon.vue'

const UI_CLASSES = {
  INPUT_BASE: 'w-full bg-vscode-bg border rounded px-3 py-2 text-sm outline-none transition-colors',
  INPUT_ERROR: 'border-nord-text-error focus:border-nord-text-error focus:ring-2 focus:ring-nord-ring-error/30 text-nord-text-error',
  INPUT_DEFAULT: 'border-nord-button-secondary focus:border-nord-button-primary focus:ring-2 focus:ring-nord-ring-primary/30 text-nord-text-primary',
  BUTTON_BASE: 'min-w-touch min-h-touch px-4 py-2 rounded transition-colors focus:outline-none focus:ring-2'
}

const emit = defineEmits(['generate', 'cancel'])

const token = ref('')
const error = ref('')
const showToken = ref(false)
const isLoading = ref(false)
let debounceTimeout = null

const resetFormState = () => {
  token.value = ''
  error.value = ''
  isLoading.value = false
  showToken.value = false
  clearTimeout(debounceTimeout)
}

const validateToken = (value) => {
  if (!value) return ''
  return VALIDATION.TOKEN.validate(value) ? '' : VALIDATION.TOKEN.ERROR
}

const handleInput = (event) => {
  token.value = VALIDATION.TOKEN.sanitize(event.target.value)

  clearTimeout(debounceTimeout)
  debounceTimeout = setTimeout(() => {
    error.value = validateToken(token.value)
  }, 300)
}

const submitGeneration = async () => {
  error.value = validateToken(token.value)
  if (error.value || !token.value) {
    if (!token.value) error.value = 'Please enter a token.'
    return
  }

  isLoading.value = true
  try {
    await emit('generate', token.value)
    resetFormState()
  } catch {
  } finally {
    isLoading.value = false
  }
}

const handleCancel = () => {
  resetFormState()
  emit('cancel')
}

onBeforeUnmount(() => clearTimeout(debounceTimeout))
</script>

<template>
  <div class="min-h-[100dvh] bg-vscode-bg text-vscode-text flex flex-col">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active shadow-lg">
      <div class="px-6 h-14 flex items-center">
        <h1 class="text-lg font-medium">Generate Private Key</h1>
      </div>
    </header>

    <main class="flex-1 overflow-auto">
      <form @submit.prevent="submitGeneration" class="container mx-auto p-6 max-w-2xl">
        <div class="space-y-2">
          <label for="auth-token" class="block text-sm font-medium text-nord-text-primary">Auth Token</label>
          <div class="relative">
            <input
              id="auth-token"
              :value="token"
              @input="handleInput"
              :type="showToken ? 'text' : 'password'"
              placeholder="64-character hexadecimal token"
              maxlength="64"
              :class="[UI_CLASSES.INPUT_BASE, error ? UI_CLASSES.INPUT_ERROR : UI_CLASSES.INPUT_DEFAULT]"
              :aria-invalid="!!error"
              :aria-describedby="error ? 'token-error' : undefined"
            >
            <button type="button" @click="showToken = !showToken" class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-nord-text-primary/70 hover:text-nord-text-primary" :aria-label="showToken ? 'Hide token' : 'Show token'">
              <Icon :name="showToken ? 'eye' : 'eyeOff'" class="w-4 h-4"/>
            </button>
          </div>
          <p v-if="error" id="token-error" class="text-xs text-nord-text-error mt-1 font-medium" role="alert">{{ error }}</p>
        </div>
      </form>
    </main>

    <footer class="bg-vscode-header border-t border-vscode-active p-4">
      <div class="container mx-auto max-w-2xl flex justify-end gap-3">
        <button
          type="button"
          @click="submitGeneration"
          :disabled="isLoading || !!error || !token"
          :class="[UI_CLASSES.BUTTON_BASE, 'text-white', isLoading || !!error || !token ? 'bg-nord-button-primary/40 cursor-not-allowed' : 'bg-nord-button-primary hover:bg-nord-button-primary-hover focus:ring-nord-ring-primary/50', 'w-[140px]']"
        >
          <span v-if="isLoading">Generating...</span>
          <span v-else>Generate</span>
        </button>
        <button type="button" @click="handleCancel" :class="[UI_CLASSES.BUTTON_BASE, 'border border-nord-button-secondary hover:bg-nord-bg-hover focus:ring-nord-ring-secondary/50']">
          Cancel
        </button>
      </div>
    </footer>
  </div>
</template>