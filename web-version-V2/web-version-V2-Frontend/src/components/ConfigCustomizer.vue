<script setup>
import { ref, computed, watch } from 'vue'
import { VALIDATION } from '@/utils/utils'
import Icon from '@/components/Icon.vue'

const props = defineProps({
  sessionPrivateKey: { type: String, required: true },
  persistedSettings: { type: Object, required: true },
  defaultSettings: { type: Object, required: true },
})

const emit = defineEmits(['apply', 'cancel'])

const localConfig = ref({})
const errors = ref({ privateKey: '', dns: '', keepalive: '' })
const showPrivateKey = ref(false)

const resetForm = () => {
  localConfig.value = {
    privateKey: props.sessionPrivateKey,
    dns: props.persistedSettings.dns,
    endpoint: props.persistedSettings.endpoint,
    keepalive: props.persistedSettings.keepalive,
  }
  errors.value = { privateKey: '', dns: '', keepalive: '' }
}

watch(() => [props.sessionPrivateKey, props.persistedSettings], resetForm, { immediate: true, deep: true })

const hasChanges = computed(() =>
  localConfig.value.privateKey !== props.sessionPrivateKey ||
  localConfig.value.dns !== props.persistedSettings.dns ||
  localConfig.value.endpoint !== props.persistedSettings.endpoint ||
  localConfig.value.keepalive !== props.persistedSettings.keepalive
)

const isValid = computed(() => !Object.values(errors.value).some(Boolean))

const validateField = (field, value) => {
  const validationMap = {
    privateKey: () => VALIDATION.PRIVATE_KEY.validate(value) ? '' : VALIDATION.PRIVATE_KEY.ERROR,
    dns: () => VALIDATION.DNS.validate(value) ? '' : VALIDATION.DNS.ERROR,
    keepalive: () => VALIDATION.KEEPALIVE.validate(value) ? '' : VALIDATION.KEEPALIVE.ERROR,
  }
  if (validationMap[field]) {
    errors.value[field] = validationMap[field]()
  }
}

watch(() => localConfig.value.privateKey, (newValue) => validateField('privateKey', newValue))
watch(() => localConfig.value.dns, (newValue) => validateField('dns', newValue))
watch(() => localConfig.value.keepalive, (newValue) => validateField('keepalive', newValue))

const applyConfig = () => {
  if (isValid.value && hasChanges.value) {
    emit('apply', localConfig.value)
  }
}

const resetToDefaults = () => {
  localConfig.value = {
    privateKey: '',
    dns: props.defaultSettings.dns,
    endpoint: props.defaultSettings.endpoint,
    keepalive: props.defaultSettings.keepalive,
  }
  Object.keys(errors.value).forEach(key => errors.value[key] = '')
}
</script>

<template>
  <div class="min-h-screen bg-vscode-bg text-vscode-text" role="dialog">
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active">
      <div class="px-4 h-14 flex items-center">
        <h1 class="text-lg font-medium">Customize Configuration</h1>
      </div>
    </header>

    <form @submit.prevent="applyConfig" class="container mx-auto px-4 py-6 max-w-2xl">
      <div class="space-y-6">
        <div>
          <label for="private-key" class="block text-sm font-medium">Private Key (session only)</label>
          <div class="relative mt-1">
            <input
              id="private-key"
              v-model="localConfig.privateKey"
              :type="showPrivateKey ? 'text' : 'password'"
              placeholder="Enter key, will not be saved in browser"
              class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm"
              :class="errors.privateKey ? 'border-nord-text-error' : 'border-nord-button-secondary'"
            >
            <button type="button" @click="showPrivateKey = !showPrivateKey" class="absolute right-2.5 top-2.5" :aria-label="showPrivateKey ? 'Hide' : 'Show'">
              <Icon :name="showPrivateKey ? 'eye' : 'eyeOff'" class="w-4 h-4" />
            </button>
          </div>
          <p v-if="errors.privateKey" class="text-xs text-nord-text-error mt-1">{{ errors.privateKey }}</p>
        </div>

        <div>
          <label for="dns" class="block text-sm font-medium">DNS</label>
          <input
            id="dns"
            v-model="localConfig.dns"
            type="text"
            :placeholder="defaultSettings.dns"
            class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm mt-1"
            :class="errors.dns ? 'border-nord-text-error' : 'border-nord-button-secondary'"
          >
          <p v-if="errors.dns" class="text-xs text-nord-text-error mt-1">{{ errors.dns }}</p>
        </div>

        <div>
          <label for="endpoint" class="block text-sm font-medium">Endpoint Type</label>
          <select id="endpoint" v-model="localConfig.endpoint" class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm mt-1 border-nord-button-secondary">
            <option value="hostname">Hostname</option>
            <option value="station">IP</option>
          </select>
        </div>

        <div>
          <label for="keepalive" class="block text-sm font-medium">Keepalive</label>
          <input
            id="keepalive"
            v-model="localConfig.keepalive"
            type="number"
            :min="VALIDATION.KEEPALIVE.MIN"
            :max="VALIDATION.KEEPALIVE.MAX"
            :placeholder="String(defaultSettings.keepalive)"
            class="w-full bg-vscode-bg border rounded px-3 py-2 text-sm mt-1"
            :class="errors.keepalive ? 'border-nord-text-error' : 'border-nord-button-secondary'"
          >
          <p v-if="errors.keepalive" class="text-xs text-nord-text-error mt-1">{{ errors.keepalive }}</p>
        </div>
      </div>

      <footer class="fixed bottom-0 left-0 right-0 bg-vscode-header border-t border-vscode-active p-4">
        <div class="container mx-auto max-w-2xl flex justify-end gap-3">
          <button type="submit" :disabled="!isValid || !hasChanges" class="px-4 py-2 rounded bg-nord-button-primary border border-transparent disabled:opacity-50">Apply</button>
          <button type="button" @click="emit('cancel')" class="px-4 py-2 rounded border border-nord-button-secondary">Cancel</button>
          <button type="button" @click="resetToDefaults" class="px-4 py-2 rounded border border-nord-button-secondary text-nord-text-secondary">Reset</button>
        </div>
      </footer>
    </form>
  </div>
</template>