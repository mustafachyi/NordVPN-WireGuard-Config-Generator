<script setup>
import { ref, computed } from 'vue'
import { VALIDATION } from '../utils/utils'
import { icons } from '../utils/icons'

// UI Constants
const ENDPOINT_OPTIONS = [
  { value: 'hostname', label: 'Hostname' },
  { value: 'station', label: 'IP' }
]

const UI = {
  INPUT_BASE: 'w-full bg-vscode-bg border rounded px-3 py-2 text-sm outline-none transition-colors',
  INPUT_ERROR: 'border-nord-text-error focus:border-nord-text-error focus:ring-2 focus:ring-nord-ring-error/30 text-nord-text-error',
  INPUT_DEFAULT: 'border-nord-button-secondary focus:border-nord-button-primary focus:ring-2 focus:ring-nord-ring-primary/30 text-nord-text-primary',
  BUTTON_BASE: 'min-w-touch min-h-touch px-4 py-2 rounded transition-colors'
}

// Props validation
const props = defineProps({
  defaultConfig: {
    type: Object,
    required: true,
    validator: value => ['dns', 'endpoint', 'keepalive'].every(key => key in value)
  },
  savedConfig: {
    type: Object,
    required: true,
    validator: value => ['privateKey', 'dns', 'endpoint', 'keepalive'].every(key => key in value || key === undefined)
  }
})

const emit = defineEmits(['save', 'cancel'])

// State
const config = ref({
  privateKey: props.savedConfig.privateKey ?? '',
  dns: props.savedConfig.dns ?? '',
  endpoint: props.savedConfig.endpoint ?? props.defaultConfig.endpoint,
  keepalive: props.savedConfig.keepalive ?? ''
})

const errors = ref({
  privateKey: '',
  dns: '',
  keepalive: ''
})

const showPrivateKey = ref(false)

// Computed
const hasChanges = computed(() => {
  const { privateKey, dns, endpoint, keepalive } = config.value
  const saved = props.savedConfig
  const def = props.defaultConfig
  return privateKey !== (saved.privateKey ?? '') ||
         dns !== (saved.dns ?? '') ||
         endpoint !== (saved.endpoint ?? def.endpoint) ||
         keepalive !== (saved.keepalive ?? '')
})

const isValid = computed(() => {
  const noErrors = !Object.values(errors.value).some(error => error)
  const validFields = 
    VALIDATION.PRIVATE_KEY.validate(config.value.privateKey) &&
    VALIDATION.DNS.validate(config.value.dns) &&
    VALIDATION.KEEPALIVE.validate(config.value.keepalive)
  return noErrors && validFields && hasChanges.value
})

const hasNonDefaultValues = computed(() => {
  const { privateKey, dns, endpoint, keepalive } = props.savedConfig
  const def = props.defaultConfig
  return Boolean(
    privateKey ||
    (dns && dns !== def.dns) ||
    (endpoint && endpoint !== def.endpoint) ||
    (keepalive && keepalive !== def.keepalive)
  )
})

// Methods
const updateConfig = (field, value) => {
  config.value[field] = value
  const validationMap = {
    privateKey: () => VALIDATION.PRIVATE_KEY.validate(value) ? '' : VALIDATION.PRIVATE_KEY.ERROR,
    dns: () => VALIDATION.DNS.validate(value) ? '' : VALIDATION.DNS.ERROR,
    keepalive: () => VALIDATION.KEEPALIVE.validate(value) ? '' : VALIDATION.KEEPALIVE.ERROR
  }
  if (field in validationMap) {
    errors.value[field] = validationMap[field]()
  }
}

const saveConfig = () => {
  if (isValid.value) {
    const { dns, keepalive, endpoint } = props.defaultConfig
    emit('save', {
      ...config.value,
      dns: config.value.dns || dns,
      keepalive: config.value.keepalive || keepalive,
      endpoint: config.value.endpoint || endpoint
    })
  }
}

const resetConfig = () => {
  config.value = {
    privateKey: '',
    dns: '',
    endpoint: props.defaultConfig.endpoint,
    keepalive: ''
  }
  errors.value = { privateKey: '', dns: '', keepalive: '' }
}
</script>

<template>
  <div class="min-h-screen bg-vscode-bg text-vscode-text" role="dialog" aria-labelledby="config-customizer-title">
    <!-- Header -->
    <header class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active shadow-lg">
      <div class="px-4 h-14 flex items-center">
        <h1 id="config-customizer-title" class="text-lg font-medium">Customize Configuration</h1>
      </div>
    </header>

    <!-- Form -->
    <form @submit.prevent="saveConfig" class="container mx-auto px-4 py-6 max-w-2xl">
      <div class="space-y-6" role="group" aria-label="Configuration options">
        <!-- Private Key -->
        <div class="space-y-2">
          <label for="private-key" class="block text-sm font-medium text-nord-text-primary">Private Key</label>
          <div class="relative">
            <input 
              id="private-key"
              :value="config.privateKey"
              @input="e => updateConfig('privateKey', e.target.value)"
              :type="showPrivateKey ? 'text' : 'password'"
              placeholder="YOUR_PRIVATE_KEY"
              :class="[UI.INPUT_BASE, errors.privateKey ? UI.INPUT_ERROR : UI.INPUT_DEFAULT]"
              :aria-invalid="!!errors.privateKey"
              :aria-describedby="errors.privateKey ? 'private-key-error' : undefined"
            >
            <button
              type="button"
              @click="showPrivateKey = !showPrivateKey"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-nord-text-primary/70 hover:text-nord-text-primary transition-colors outline-none"
              :aria-label="showPrivateKey ? 'Hide private key' : 'Show private key'"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true">
                <path :d="showPrivateKey ? icons.eye : icons.eyeOff"/>
              </svg>
            </button>
          </div>
          <p 
            v-if="errors.privateKey" 
            id="private-key-error" 
            class="text-xs text-nord-text-error mt-1 font-medium"
            role="alert"
          >
            {{ errors.privateKey }}
          </p>
        </div>

        <!-- DNS -->
        <div class="space-y-2">
          <label for="dns" class="block text-sm font-medium text-nord-text-primary">DNS</label>
          <input 
            id="dns"
            :value="config.dns"
            @input="e => updateConfig('dns', e.target.value)"
            type="text"
            :placeholder="`${defaultConfig.dns} (e.g., 103.86.96.100, 8.8.8.8)`"
            :class="[UI.INPUT_BASE, errors.dns ? UI.INPUT_ERROR : UI.INPUT_DEFAULT]"
            :aria-invalid="!!errors.dns"
            :aria-describedby="errors.dns ? 'dns-error' : undefined"
          >
          <p 
            v-if="errors.dns" 
            id="dns-error" 
            class="text-xs text-nord-text-error mt-1 font-medium"
            role="alert"
          >
            {{ errors.dns }}
          </p>
        </div>

        <!-- Endpoint Type -->
        <div class="space-y-2">
          <label for="endpoint" class="block text-sm font-medium text-nord-text-primary">Endpoint Type</label>
          <select 
            id="endpoint"
            v-model="config.endpoint"
            :class="[UI.INPUT_BASE, UI.INPUT_DEFAULT, 'appearance-none cursor-pointer']"
          >
            <option 
              v-for="option in ENDPOINT_OPTIONS" 
              :key="option.value" 
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>

        <!-- Keepalive -->
        <div class="space-y-2">
          <label for="keepalive" class="block text-sm font-medium text-nord-text-primary">
            Keepalive ({{ VALIDATION.KEEPALIVE.MIN }}-{{ VALIDATION.KEEPALIVE.MAX }} seconds)
          </label>
          <input 
            id="keepalive"
            :value="config.keepalive"
            @input="e => updateConfig('keepalive', e.target.value)"
            type="number"
            :min="VALIDATION.KEEPALIVE.MIN"
            :max="VALIDATION.KEEPALIVE.MAX"
            :placeholder="defaultConfig.keepalive.toString()"
            :class="[
              UI.INPUT_BASE, 
              errors.keepalive ? UI.INPUT_ERROR : UI.INPUT_DEFAULT,
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
            ]"
            :aria-invalid="!!errors.keepalive"
            :aria-describedby="errors.keepalive ? 'keepalive-error' : undefined"
          >
          <p 
            v-if="errors.keepalive" 
            id="keepalive-error" 
            class="text-xs text-nord-text-error mt-1 font-medium"
            role="alert"
          >
            {{ errors.keepalive }}
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="fixed bottom-0 left-0 right-0 bg-vscode-header border-t border-vscode-active p-4">
        <div class="container mx-auto max-w-2xl flex justify-end gap-3">
          <button 
            type="submit"
            :disabled="!isValid"
            :class="[
              UI.BUTTON_BASE,
              'text-white',
              isValid ? 'bg-nord-button-primary hover:bg-nord-button-primary-hover focus:ring-2 focus:ring-nord-ring-primary/50' : 'bg-nord-button-primary/40 cursor-not-allowed'
            ]"
            aria-label="Save configuration"
          >
            Save
          </button>
          <button 
            type="button"
            @click="$emit('cancel')"
            :class="[UI.BUTTON_BASE, 'border border-nord-button-secondary hover:bg-nord-bg-hover focus:ring-2 focus:ring-nord-ring-secondary/50']"
            aria-label="Cancel changes"
          >
            Cancel
          </button>
          <button 
            v-if="hasNonDefaultValues"
            type="button"
            @click="resetConfig"
            :class="[UI.BUTTON_BASE, 'border border-nord-button-secondary hover:bg-nord-bg-hover text-nord-text-secondary focus:ring-2 focus:ring-nord-ring-secondary/50']"
            aria-label="Reset to default values"
          >
            Reset
          </button>
        </div>
      </div>
    </form>
  </div>
</template>
