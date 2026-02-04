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
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active flex-none">
      <div class="px-4 h-14 flex items-center"><h1 class="text-base font-medium">Generate Private Key</h1></div>
    </header>

    <main class="flex-1 container mx-auto px-4 py-6 max-w-xl">
      <div class="bg-vscode-bg/50 border border-vscode-active/50 rounded-md p-3 mb-6">
        <p class="text-xs text-nord-text-secondary leading-relaxed">Enter your NordVPN token to generate a session-only private key. The token is never stored and is used exclusively for this immediate request.</p>
      </div>
      
      <form @submit.prevent="submit">
        <div>
          <label for="tok" class="block text-xs font-medium text-nord-text-secondary mb-1.5">Auth Token</label>
          <div class="relative">
            <input id="tok" :value="token" @input="e => handleInput(e.target.value)" :type="show ? 'text' : 'password'" placeholder="64-character hex token" maxlength="64" class="w-full h-9 bg-vscode-bg border rounded px-3 pr-10 text-sm focus:border-vscode-accent focus:ring-1 focus:ring-vscode-accent transition-colors outline-none placeholder:text-nord-button-secondary font-mono" :class="error ? 'border-nord-text-error' : 'border-nord-button-secondary'">
            <button type="button" @click="show = !show" class="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-nord-text-secondary hover:text-vscode-text transition-colors" tabindex="-1"><Icon :name="show ? 'eye' : 'eyeOff'" class="w-4 h-4"/></button>
          </div>
          <p v-if="error" class="text-xs text-nord-text-error mt-1">{{ error }}</p>
        </div>
      </form>
    </main>

    <footer class="sticky bottom-0 bg-vscode-header border-t border-vscode-active p-4 flex-none">
      <div class="container mx-auto max-w-xl flex items-center justify-end gap-2 sm:gap-3">
        <button type="button" @click="emit('cancel')" class="h-9 px-3 sm:px-4 rounded border border-nord-button-secondary text-vscode-text text-sm font-medium hover:bg-nord-bg-hover transition-colors whitespace-nowrap">Cancel</button>
        <button type="button" @click="submit" :disabled="loading || !!error || !token" class="h-9 px-3 sm:px-4 rounded bg-nord-button-primary text-white text-sm font-medium hover:bg-nord-button-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[100px] flex justify-center items-center whitespace-nowrap">
          <div v-if="loading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span v-else>Generate</span>
        </button>
      </div>
    </footer>
  </div>
</template>