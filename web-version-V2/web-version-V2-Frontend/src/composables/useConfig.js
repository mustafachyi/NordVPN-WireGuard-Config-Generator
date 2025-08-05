import { ref } from 'vue'
import { apiService } from '@/services/apiService'
import { storageService } from '@/services/storageService'
import { VALIDATION, sanitizeServerName } from '@/utils/utils'

const STORAGE_KEY_SETTINGS = 'wg_gen_settings'

const defaultSettings = {
  dns: '103.86.96.100',
  endpoint: 'hostname',
  keepalive: 25,
}

const validateSettings = settings => {
  if (!settings || typeof settings !== 'object') return false
  return (
    VALIDATION.DNS.validate(settings.dns) &&
    ['hostname', 'station'].includes(settings.endpoint) &&
    VALIDATION.KEEPALIVE.validate(settings.keepalive)
  )
}

export function useConfig() {
  const sessionPrivateKey = ref('')
  const persistedSettings = ref({ ...defaultSettings })

  const loadPersistedSettings = () => {
    const saved = storageService.get(STORAGE_KEY_SETTINGS)
    if (saved && validateSettings(saved)) {
      persistedSettings.value = { ...defaultSettings, ...saved }
    } else {
      storageService.remove(STORAGE_KEY_SETTINGS)
    }
  }

  const saveSettings = (newSettings) => {
    const updatedSettings = { ...persistedSettings.value, ...newSettings }
    if (!validateSettings(updatedSettings)) {
      throw new Error('Attempted to save invalid settings.')
    }
    storageService.set(STORAGE_KEY_SETTINGS, updatedSettings)
    persistedSettings.value = updatedSettings
  }
  
  const setSessionPrivateKey = (key) => {
    if (VALIDATION.PRIVATE_KEY.validate(key)) {
      sessionPrivateKey.value = key
    } else {
      throw new Error(VALIDATION.PRIVATE_KEY.ERROR)
    }
  }

  const prepareConfig = (server) => {
    return {
      country: sanitizeServerName(server.country),
      city: sanitizeServerName(server.city),
      name: server.name,
      privateKey: sessionPrivateKey.value,
      dns: persistedSettings.value.dns,
      endpoint: persistedSettings.value.endpoint,
      keepalive: persistedSettings.value.keepalive,
    }
  }
  
  const downloadConfig = async (server) => {
    const config = prepareConfig(server)
    const blob = await apiService.downloadConfig(config)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${server.name}.conf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const copyConfig = async (server) => {
    const configText = await apiService.generateConfig(prepareConfig(server))
    await navigator.clipboard.writeText(configText)
  }

  return {
    sessionPrivateKey,
    persistedSettings,
    defaultSettings,
    loadPersistedSettings,
    saveSettings,
    setSessionPrivateKey,
    downloadConfig,
    copyConfig,
    prepareConfig,
  }
}