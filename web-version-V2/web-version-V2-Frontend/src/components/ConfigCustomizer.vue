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
  <div class="min-h-screen bg-vscode-bg text-vscode-text" role="dialog">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active">
      <div class="px-4 h-14 flex items-center"><h1 class="text-lg font-medium">Customize Configuration</h1></div>
    </header>

    <form @submit.prevent="isValid && hasChanges && emit('apply', localConfig)" class="container mx-auto px-4 py-6 max-w-2xl">
      <div class="space-y-6">
        <div>
          <label for="pk" class="block text-sm font-medium">Private Key (session only)</label>
          <div class="relative mt-1">
            <input id="pk" v-model="localConfig.privateKey" :type="showKey ? 'text' : 'password'" placeholder="Enter key" class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm" :class="errors.privateKey ? 'border-nord-text-error' : 'border-nord-button-secondary'">
            <button type="button" @click="showKey = !showKey" class="absolute right-2.5 top-2.5"><Icon :name="showKey ? 'eye' : 'eyeOff'" class="w-4 h-4" /></button>
          </div>
          <p v-if="errors.privateKey" class="text-xs text-nord-text-error mt-1">{{ errors.privateKey }}</p>
        </div>

        <div>
          <label for="dns" class="block text-sm font-medium">DNS</label>
          <input id="dns" v-model="localConfig.dns" type="text" :placeholder="defaultSettings.dns" class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm mt-1" :class="errors.dns ? 'border-nord-text-error' : 'border-nord-button-secondary'">
          <p v-if="errors.dns" class="text-xs text-nord-text-error mt-1">{{ errors.dns }}</p>
        </div>

        <div>
          <label for="ep" class="block text-sm font-medium">Endpoint Type</label>
          <select id="ep" v-model="localConfig.endpoint" class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm mt-1 border-nord-button-secondary">
            <option value="hostname">Hostname</option>
            <option value="station">IP</option>
          </select>
        </div>

        <div>
          <label for="ka" class="block text-sm font-medium">Keepalive</label>
          <input id="ka" v-model="localConfig.keepalive" type="number" :min="Validators.Keepalive.min" :max="Validators.Keepalive.max" :placeholder="String(defaultSettings.keepalive)" class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm mt-1" :class="errors.keepalive ? 'border-nord-text-error' : 'border-nord-button-secondary'">
          <p v-if="errors.keepalive" class="text-xs text-nord-text-error mt-1">{{ errors.keepalive }}</p>
        </div>
      </div>

      <footer class="fixed bottom-0 left-0 right-0 bg-vscode-header border-t border-vscode-active p-4">
        <div class="container mx-auto max-w-2xl flex justify-end gap-3">
          <button type="submit" :disabled="!isValid || !hasChanges" class="px-4 py-2 rounded bg-nord-button-primary border border-transparent disabled:opacity-50">Apply</button>
          <button type="button" @click="emit('cancel')" class="px-4 py-2 rounded border border-nord-button-secondary">Cancel</button>
          <button type="button" @click="defaults" class="px-4 py-2 rounded border border-nord-button-secondary text-nord-text-secondary">Reset</button>
        </div>
      </footer>
    </form>
  </div>
</template>