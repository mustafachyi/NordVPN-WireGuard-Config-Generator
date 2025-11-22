<script setup>
import { ref } from 'vue'
import { Validators } from '@/utils/utils'
import Icon from '@/components/Icon.vue'

const emit = defineEmits(['generate', 'cancel'])
const token = ref('')
const error = ref('')
const show = ref(false)
const loading = ref(false)

const handleInput = val => {
  token.value = Validators.Token.clean(val)
  error.value = Validators.Token.valid(token.value) ? '' : Validators.Token.err
}

const submit = async () => {
  if (!token.value || !Validators.Token.valid(token.value)) {
    error.value = Validators.Token.err
    return
  }
  loading.value = true
  try { await emit('generate', token.value) }
  finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen bg-vscode-bg text-vscode-text flex flex-col">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active">
      <div class="px-4 h-14 flex items-center"><h1 class="text-lg font-medium">Generate Private Key</h1></div>
    </header>

    <main class="flex-1">
      <form @submit.prevent="submit" class="container mx-auto px-4 py-6 max-w-2xl">
        <p class="text-sm text-nord-text-secondary mb-4">Generate a session-only private key with a NordVPN auth token. The key is not stored.</p>
        <div>
          <label for="tok" class="block text-sm font-medium">Auth Token</label>
          <div class="relative mt-1">
            <input id="tok" :value="token" @input="e => handleInput(e.target.value)" :type="show ? 'text' : 'password'" placeholder="64-character hex token" maxlength="64" class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm pr-20" :class="error ? 'border-nord-text-error' : 'border-nord-button-secondary'">
            <div class="absolute right-2 top-1.5">
              <button type="button" @click="show = !show" class="p-1 rounded hover:bg-nord-bg-hover text-nord-text-secondary"><Icon :name="show ? 'eye' : 'eyeOff'" class="w-4 h-4"/></button>
            </div>
          </div>
          <p v-if="error" class="text-xs text-nord-text-error mt-1">{{ error }}</p>
        </div>
      </form>
    </main>

    <footer class="bg-vscode-header border-t border-vscode-active p-4">
      <div class="container mx-auto max-w-2xl flex justify-end gap-3">
        <button type="button" @click="submit" :disabled="loading || !!error || !token" class="px-4 py-2 rounded bg-nord-button-primary border border-transparent disabled:opacity-50">{{ loading ? 'Generating...' : 'Generate' }}</button>
        <button type="button" @click="emit('cancel')" class="px-4 py-2 rounded border border-nord-button-secondary">Cancel</button>
      </div>
    </footer>
  </div>
</template>