import { ref, onMounted, onUnmounted } from 'vue'
import { apiService } from '../services/apiService'
import secureStorageService, { storageEventBus } from '../services/secureStorageService'
import { VALIDATION, sanitizeServerName } from '../utils/utils'

const STORAGE_KEYS = {
  CONFIG: 'wireguard_config',
}

export const defaultConfig = {
  privateKey: '',
  dns: '103.86.96.100',
  endpoint: 'hostname',
  keepalive: 25
}

const validateConfig = config => {
  if (!config || typeof config !== 'object') return false
  const hasRequiredFields = ['privateKey', 'dns', 'endpoint', 'keepalive']
    .every(field => field in config)
  if (!hasRequiredFields) return false

  return (
    (!config.privateKey || VALIDATION.PRIVATE_KEY.validate(config.privateKey)) &&
    VALIDATION.DNS.validate(config.dns) &&
    ['hostname', 'station'].includes(config.endpoint) &&
    VALIDATION.KEEPALIVE.validate(config.keepalive)
  )
}

export const prepareConfig = (server, settings) => ({
  country: sanitizeServerName(server.country),
  city: sanitizeServerName(server.city),
  name: server.name,
  privateKey: settings?.privateKey || '',
  dns: (settings?.dns || defaultConfig.dns).split(',').map(ip => ip.trim()).join(', '),
  endpoint: settings?.endpoint || defaultConfig.endpoint,
  keepalive: +(settings?.keepalive ?? defaultConfig.keepalive)
})

export function useConfig() {
  const configSettings = ref({ ...defaultConfig })

  const handleStorageEvent = () => {
    loadSavedConfig().catch(err => {
      console.error(`Forced config reload failed: ${err.message}`)
    })
  }

  onMounted(() => {
    storageEventBus.addEventListener('storage-reset', handleStorageEvent)
    storageEventBus.addEventListener('storage-tampered', handleStorageEvent)
  })

  onUnmounted(() => {
    storageEventBus.removeEventListener('storage-reset', handleStorageEvent)
    storageEventBus.removeEventListener('storage-tampered', handleStorageEvent)
  })

  const loadSavedConfig = async () => {
    try {
      const saved = await secureStorageService.get(STORAGE_KEYS.CONFIG)
      if (saved && !validateConfig(saved)) {
        throw new Error('Config in storage is invalid or tampered.')
      }
      configSettings.value = { ...defaultConfig, ...(saved || {}) }
    } catch (err) {
      configSettings.value = { ...defaultConfig }
      await secureStorageService.remove(STORAGE_KEYS.CONFIG)
      throw err
    }
  }

  const saveConfig = async (newConfig) => {
    if (!validateConfig(newConfig)) {
      throw new Error('Attempted to save invalid configuration.')
    }
    const configToSave = { ...defaultConfig, ...newConfig }
    await secureStorageService.set(STORAGE_KEYS.CONFIG, configToSave)
    configSettings.value = configToSave
  }

  const downloadConfig = async (server) => {
    const config = prepareConfig(server, configSettings.value)
    const blob = new Blob([await apiService.downloadConfig(config)], { type: 'application/x-wireguard-config' })
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
    const configText = await apiService.generateConfig(prepareConfig(server, configSettings.value))
    await navigator.clipboard.writeText(configText)
  }

  return {
    configSettings,
    defaultConfig,
    loadSavedConfig,
    saveConfig,
    downloadConfig,
    copyConfig
  }
}