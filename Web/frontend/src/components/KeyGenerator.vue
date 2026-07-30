<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { Validators } from '@/utils/utils'
import { api } from '@/services/apiService'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import Icon from '@/components/Icon.vue'

const config = useConfig()
const ui = useUI()
const notifications = useToast()

const token = ref('')
const error = ref('')
const show = ref(false)
const loading = ref(false)
let requestController = null

const handleInput = value => {
  token.value = Validators.Token.clean(value)
  error.value = Validators.Token.valid(token.value) ? '' : Validators.Token.err
}

const submit = async () => {
  if (loading.value) return

  if (!token.value || !Validators.Token.valid(token.value)) {
    error.value = Validators.Token.err
    return
  }

  const controller = new AbortController()
  requestController = controller
  loading.value = true

  try {
    const { key } = await api.genKey(token.value, controller.signal)
    config.setKey(key)
    token.value = ''
    ui.modals.value.key = false
    notifications.show('Key generated', 'success')
  } catch (requestError) {
    if (!controller.signal.aborted) {
      notifications.show(requestError.message || 'Generation failed', 'error')
    }
  } finally {
    if (requestController === controller) {
      requestController = null
    }

    loading.value = false
  }
}

const cancel = () => {
  requestController?.abort()
  token.value = ''
  ui.modals.value.key = false
}

onBeforeUnmount(() => {
  requestController?.abort()
})
</script>

<template>
  <div
    class="min-h-screen bg-app-bg text-app-text flex flex-col"
    role="dialog"
    aria-modal="true"
    aria-labelledby="key-generator-title"
  >
    <header class="sticky top-0 z-50 bg-app-surface border-b border-app-border flex-none">
      <div class="px-4 h-14 flex items-center">
        <h1 id="key-generator-title" class="text-base font-medium">
          Generate Private Key
        </h1>
      </div>
    </header>

    <main class="flex-1 container mx-auto px-4 py-6 max-w-xl">
      <div class="bg-app-bg/50 border border-app-border/50 rounded-md p-3 mb-6">
        <p class="text-xs text-nord-text-secondary leading-relaxed">
          Enter your NordVPN access token to generate a session-only private
          key. The token is not stored and is used only for this request.
        </p>
      </div>

      <form @submit.prevent="submit">
        <div>
          <label
            for="tok"
            class="block text-xs font-medium text-nord-text-secondary mb-1.5"
          >
            Access Token
          </label>

          <div class="relative">
            <input
              id="tok"
              :value="token"
              :type="show ? 'text' : 'password'"
              autocomplete="off"
              placeholder="64-character hexadecimal token"
              maxlength="64"
              class="w-full h-9 bg-app-bg border rounded px-3 pr-10 text-sm focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors placeholder:text-nord-button-secondary font-mono"
              :class="error
                ? 'border-nord-text-error'
                : 'border-nord-button-secondary'"
              @input="event => handleInput(event.target.value)"
            >
            <button
              type="button"
              :aria-label="show ? 'Hide access token' : 'Show access token'"
              class="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-nord-text-secondary hover:text-app-text transition-colors"
              @click="show = !show"
            >
              <Icon :name="show ? 'eye' : 'eyeOff'" class="w-4 h-4" />
            </button>
          </div>

          <p v-if="error" class="text-xs text-nord-text-error mt-1">
            {{ error }}
          </p>
        </div>
      </form>
    </main>

    <footer class="sticky bottom-0 bg-app-surface border-t border-app-border p-4 flex-none">
      <div class="container mx-auto max-w-xl flex items-center justify-end gap-2 sm:gap-3">
        <button
          type="button"
          class="h-9 px-3 sm:px-4 rounded border border-nord-button-secondary text-app-text text-sm font-medium hover:bg-nord-bg-hover transition-colors whitespace-nowrap"
          @click="cancel"
        >
          Cancel
        </button>

        <button
          type="button"
          :disabled="loading || !!error || !token"
          class="h-9 px-3 sm:px-4 rounded bg-nord-button-primary text-white text-sm font-medium hover:bg-nord-button-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-25 flex justify-center items-center whitespace-nowrap"
          @click="submit"
        >
          <div
            v-if="loading"
            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
          />
          <span v-else>Generate</span>
        </button>
      </div>
    </footer>
  </div>
</template>