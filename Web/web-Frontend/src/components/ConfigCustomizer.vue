<script setup>
import { ref, computed, watch } from 'vue'
import { Validators } from '@/utils/utils'
import Icon from '@/components/Icon.vue'

const props = defineProps({
  sessionPrivateKey: { type: String, required: true },
  persistedSettings: { type: Object, required: true },
  defaultSettings: { type: Object, required: true },
})

const emit = defineEmits(['apply', 'cancel'])

const localConfig = ref({})
const errors = ref({ privateKey: '', dns: '', keepalive: '' })
const showKey = ref(false)

const reset = () => {
  localConfig.value = {
    privateKey: props.sessionPrivateKey,
    dns: props.persistedSettings.dns,
    endpoint: props.persistedSettings.endpoint,
    keepalive: props.persistedSettings.keepalive,
  }
  errors.value = { privateKey: '', dns: '', keepalive: '' }
}

watch(() => [props.sessionPrivateKey, props.persistedSettings], reset, { immediate: true, deep: true })

const hasChanges = computed(() =>
  localConfig.value.privateKey !== props.sessionPrivateKey ||
  localConfig.value.dns !== props.persistedSettings.dns ||
  localConfig.value.endpoint !== props.persistedSettings.endpoint ||
  localConfig.value.keepalive !== props.persistedSettings.keepalive
)

const isValid = computed(() => !Object.values(errors.value).some(Boolean))

const validate = (field, val) => {
  if (field === 'privateKey') errors.value.privateKey = Validators.Key.valid(val) ? '' : Validators.Key.err
  else if (field === 'dns') errors.value.dns = Validators.DNS.valid(val) ? '' : Validators.DNS.err
  else if (field === 'keepalive') errors.value.keepalive = Validators.Keepalive.valid(val) ? '' : Validators.Keepalive.err
}

watch(() => localConfig.value.privateKey, v => validate('privateKey', v))
watch(() => localConfig.value.dns, v => validate('dns', v))
watch(() => localConfig.value.keepalive, v => validate('keepalive', v))

const defaults = () => {
  localConfig.value = {
    privateKey: '',
    dns: props.defaultSettings.dns,
    endpoint: props.defaultSettings.endpoint,
    keepalive: props.defaultSettings.keepalive,
  }
  errors.value = { privateKey: '', dns: '', keepalive: '' }
}
</script>

<template>
  <div class="min-h-screen bg-vscode-bg text-vscode-text flex flex-col" role="dialog">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active flex-none">
      <div class="px-4 h-14 flex items-center"><h1 class="text-base font-medium">Customize Configuration</h1></div>
    </header>

    <form @submit.prevent="isValid && hasChanges && emit('apply', localConfig)" class="flex-1 container mx-auto px-4 py-6 max-w-xl">
      <div class="space-y-5">
        <div>
          <label for="pk" class="block text-xs font-medium text-nord-text-secondary mb-1.5">Private Key (session only)</label>
          <div class="relative">
            <input id="pk" v-model="localConfig.privateKey" :type="showKey ? 'text' : 'password'" placeholder="Enter key" class="w-full h-9 bg-vscode-bg border rounded px-3 pr-10 text-sm focus:border-vscode-accent focus:ring-1 focus:ring-vscode-accent transition-colors outline-none placeholder:text-nord-button-secondary" :class="errors.privateKey ? 'border-nord-text-error' : 'border-nord-button-secondary'">
            <button type="button" @click="showKey = !showKey" class="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-nord-text-secondary hover:text-vscode-text transition-colors" tabindex="-1"><Icon :name="showKey ? 'eye' : 'eyeOff'" class="w-4 h-4" /></button>
          </div>
          <p v-if="errors.privateKey" class="text-xs text-nord-text-error mt-1">{{ errors.privateKey }}</p>
        </div>

        <div>
          <label for="dns" class="block text-xs font-medium text-nord-text-secondary mb-1.5">DNS</label>
          <input id="dns" v-model="localConfig.dns" type="text" :placeholder="defaultSettings.dns" class="w-full h-9 bg-vscode-bg border rounded px-3 text-sm focus:border-vscode-accent focus:ring-1 focus:ring-vscode-accent transition-colors outline-none placeholder:text-nord-button-secondary" :class="errors.dns ? 'border-nord-text-error' : 'border-nord-button-secondary'">
          <p v-if="errors.dns" class="text-xs text-nord-text-error mt-1">{{ errors.dns }}</p>
        </div>

        <div>
          <label for="ep" class="block text-xs font-medium text-nord-text-secondary mb-1.5">Endpoint Type</label>
          <div class="relative">
            <select id="ep" v-model="localConfig.endpoint" class="w-full h-9 bg-vscode-bg border rounded px-3 text-sm appearance-none border-nord-button-secondary focus:border-vscode-accent focus:ring-1 focus:ring-vscode-accent transition-colors outline-none cursor-pointer">
              <option value="hostname">Hostname</option>
              <option value="station">IP Address</option>
            </select>
            <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-nord-text-secondary"><Icon name="sortDesc" class="w-3 h-3" /></div>
          </div>
        </div>

        <div>
          <label for="ka" class="block text-xs font-medium text-nord-text-secondary mb-1.5">Keepalive (seconds)</label>
          <input id="ka" v-model="localConfig.keepalive" type="number" :min="Validators.Keepalive.min" :max="Validators.Keepalive.max" :placeholder="String(defaultSettings.keepalive)" class="w-full h-9 bg-vscode-bg border rounded px-3 text-sm focus:border-vscode-accent focus:ring-1 focus:ring-vscode-accent transition-colors outline-none placeholder:text-nord-button-secondary" :class="errors.keepalive ? 'border-nord-text-error' : 'border-nord-button-secondary'">
          <p v-if="errors.keepalive" class="text-xs text-nord-text-error mt-1">{{ errors.keepalive }}</p>
        </div>
      </div>
    </form>

    <footer class="sticky bottom-0 bg-vscode-header border-t border-vscode-active p-4 flex-none">
      <div class="container mx-auto max-w-xl flex items-center justify-end gap-2 sm:gap-3">
        <button type="button" @click="defaults" class="h-9 px-3 sm:px-4 rounded border border-nord-button-secondary text-nord-text-secondary text-sm font-medium hover:bg-nord-bg-hover hover:text-vscode-text transition-colors whitespace-nowrap">Reset</button>
        <button type="button" @click="emit('cancel')" class="h-9 px-3 sm:px-4 rounded border border-nord-button-secondary text-vscode-text text-sm font-medium hover:bg-nord-bg-hover transition-colors whitespace-nowrap">Cancel</button>
        <button type="button" @click="isValid && hasChanges && emit('apply', localConfig)" :disabled="!isValid || !hasChanges" class="h-9 px-3 sm:px-4 rounded bg-nord-button-primary text-white text-sm font-medium hover:bg-nord-button-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap">Apply</button>
      </div>
    </footer>
  </div>
</template>