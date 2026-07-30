<script setup>
import { computed, ref, watch } from 'vue'
import { Validators } from '@/utils/utils'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import Icon from '@/components/Icon.vue'

const config = useConfig()
const ui = useUI()
const notifications = useToast()

const localConfig = ref({})
const errors = ref({ privateKey: '', dns: '', keepalive: '' })
const showKey = ref(false)

const reset = () => {
  localConfig.value = {
    privateKey: config.privateKey.value,
    dns: config.settings.value.dns,
    endpoint: config.settings.value.endpoint,
    keepalive: config.settings.value.keepalive,
  }
  errors.value = { privateKey: '', dns: '', keepalive: '' }
}

watch(
  () => [config.privateKey.value, config.settings.value],
  reset,
  { immediate: true, deep: true },
)

const hasChanges = computed(() =>
  localConfig.value.privateKey !== config.privateKey.value
  || localConfig.value.dns !== config.settings.value.dns
  || localConfig.value.endpoint !== config.settings.value.endpoint
  || Number(localConfig.value.keepalive) !== config.settings.value.keepalive
)

const isValid = computed(() => !Object.values(errors.value).some(Boolean))

const validate = (field, value) => {
  if (field === 'privateKey') {
    errors.value.privateKey = Validators.Key.valid(value) ? '' : Validators.Key.err
  } else if (field === 'dns') {
    errors.value.dns = Validators.DNS.valid(value) ? '' : Validators.DNS.err
  } else if (field === 'keepalive') {
    errors.value.keepalive = Validators.Keepalive.valid(value)
      ? ''
      : Validators.Keepalive.err
  }
}

watch(() => localConfig.value.privateKey, value => validate('privateKey', value))
watch(() => localConfig.value.dns, value => validate('dns', value))
watch(() => localConfig.value.keepalive, value => validate('keepalive', value))

const apply = () => {
  try {
    config.applyConfiguration(localConfig.value)
    ui.modals.value.custom = false
    notifications.show('Settings applied', 'success')
  } catch (error) {
    notifications.show(error.message || 'Settings could not be applied', 'error')
  }
}

const defaults = () => {
  localConfig.value = {
    privateKey: '',
    dns: config.defaults.dns,
    endpoint: config.defaults.endpoint,
    keepalive: config.defaults.keepalive,
  }
  errors.value = { privateKey: '', dns: '', keepalive: '' }
}

const cancel = () => {
  ui.modals.value.custom = false
}
</script>

<template>
  <div
    class="min-h-screen bg-app-bg text-app-text flex flex-col"
    role="dialog"
    aria-modal="true"
    aria-labelledby="configuration-title"
  >
    <header class="sticky top-0 z-50 bg-app-surface border-b border-app-border flex-none">
      <div class="px-4 h-14 flex items-center">
        <h1 id="configuration-title" class="text-base font-medium">
          Customize Configuration
        </h1>
      </div>
    </header>

    <form
      class="flex-1 container mx-auto px-4 py-6 max-w-xl"
      @submit.prevent="isValid && hasChanges && apply()"
    >
      <div class="space-y-5">
        <div>
          <label
            for="pk"
            class="block text-xs font-medium text-nord-text-secondary mb-1.5"
          >
            Private Key (session only)
          </label>

          <div class="relative">
            <input
              id="pk"
              v-model="localConfig.privateKey"
              :type="showKey ? 'text' : 'password'"
              autocomplete="off"
              placeholder="Enter key"
              class="w-full h-9 bg-app-bg border rounded px-3 pr-10 text-sm focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors placeholder:text-nord-button-secondary"
              :class="errors.privateKey
                ? 'border-nord-text-error'
                : 'border-nord-button-secondary'"
            >
            <button
              type="button"
              :aria-label="showKey ? 'Hide private key' : 'Show private key'"
              class="absolute right-0 top-0 h-9 w-9 flex items-center justify-center text-nord-text-secondary hover:text-app-text transition-colors"
              @click="showKey = !showKey"
            >
              <Icon :name="showKey ? 'eye' : 'eyeOff'" class="w-4 h-4" />
            </button>
          </div>

          <p
            v-if="errors.privateKey"
            class="text-xs text-nord-text-error mt-1"
          >
            {{ errors.privateKey }}
          </p>
        </div>

        <div>
          <label
            for="dns"
            class="block text-xs font-medium text-nord-text-secondary mb-1.5"
          >
            DNS
          </label>
          <input
            id="dns"
            v-model="localConfig.dns"
            type="text"
            :placeholder="config.defaults.dns"
            class="w-full h-9 bg-app-bg border rounded px-3 text-sm focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors placeholder:text-nord-button-secondary"
            :class="errors.dns
              ? 'border-nord-text-error'
              : 'border-nord-button-secondary'"
          >
          <p v-if="errors.dns" class="text-xs text-nord-text-error mt-1">
            {{ errors.dns }}
          </p>
        </div>

        <div>
          <label
            for="ep"
            class="block text-xs font-medium text-nord-text-secondary mb-1.5"
          >
            Endpoint Type
          </label>

          <div class="relative">
            <select
              id="ep"
              v-model="localConfig.endpoint"
              class="w-full h-9 bg-app-bg border rounded px-3 text-sm appearance-none border-nord-button-secondary focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors cursor-pointer"
            >
              <option value="hostname">Hostname</option>
              <option value="station">IP Address</option>
            </select>
            <div
              class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-nord-text-secondary"
            >
              <Icon name="sortDesc" class="w-3 h-3" />
            </div>
          </div>
        </div>

        <div>
          <label
            for="ka"
            class="block text-xs font-medium text-nord-text-secondary mb-1.5"
          >
            Keepalive (seconds)
          </label>
          <input
            id="ka"
            v-model="localConfig.keepalive"
            type="number"
            :min="Validators.Keepalive.min"
            :max="Validators.Keepalive.max"
            :placeholder="String(config.defaults.keepalive)"
            class="w-full h-9 bg-app-bg border rounded px-3 text-sm focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-colors placeholder:text-nord-button-secondary"
            :class="errors.keepalive
              ? 'border-nord-text-error'
              : 'border-nord-button-secondary'"
          >
          <p v-if="errors.keepalive" class="text-xs text-nord-text-error mt-1">
            {{ errors.keepalive }}
          </p>
        </div>
      </div>
    </form>

    <footer class="sticky bottom-0 bg-app-surface border-t border-app-border p-4 flex-none">
      <div class="container mx-auto max-w-xl flex items-center justify-end gap-2 sm:gap-3">
        <button
          type="button"
          class="h-9 px-3 sm:px-4 rounded border border-nord-button-secondary text-nord-text-secondary text-sm font-medium hover:bg-nord-bg-hover hover:text-app-text transition-colors whitespace-nowrap"
          @click="defaults"
        >
          Reset
        </button>
        <button
          type="button"
          class="h-9 px-3 sm:px-4 rounded border border-nord-button-secondary text-app-text text-sm font-medium hover:bg-nord-bg-hover transition-colors whitespace-nowrap"
          @click="cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          :disabled="!isValid || !hasChanges"
          class="h-9 px-3 sm:px-4 rounded bg-nord-button-primary text-white text-sm font-medium hover:bg-nord-button-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          @click="isValid && hasChanges && apply()"
        >
          Apply
        </button>
      </div>
    </footer>
  </div>
</template>