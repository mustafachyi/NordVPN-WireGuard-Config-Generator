import { ref, toRefs, onMounted, onUnmounted } from 'vue'
import { apiService } from '../services/apiService'
import secureStorageService, { storageEventBus } from '../services/secureStorageService'
import { VALIDATION, sanitizeServerName } from '../utils/utils'

// Storage keys
const KEYS = {
  CONFIG: 'wireguard_config',
  SERVERS: 'servers_list',
  TOKEN: 'nord_token'
}

// Default configuration
export const defaultConfig = {
  privateKey: '',
  dns: '103.86.96.100',
  endpoint: 'hostname',
  keepalive: 25
}

// Validation helpers
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
  dns: (settings?.dns || defaultConfig.dns)
    .split(',')
    .map(ip => ip.trim())
    .join(', '),
  endpoint: settings?.endpoint || defaultConfig.endpoint,
  keepalive: +(settings?.keepalive ?? defaultConfig.keepalive)
})

/**
 * Composable for managing WireGuard configuration
 * @returns {Object} Configuration state and methods
 */
export function useConfig() {
  // State
  const state = ref({
    configSettings: { ...defaultConfig },
    error: null,
    lastToast: null
  })

  const { configSettings, error, lastToast } = toRefs(state.value)

  // Event handlers
  const handleStorageReset = ({ detail }) => {
    configSettings.value = { ...defaultConfig }
    lastToast.value = {
      message: `Configuration reset: ${detail.reason}`,
      type: 'warning'
    }
  }

  const handleStorageTampered = ({ detail: { invalidKeys } }) => {
    if (invalidKeys.includes(KEYS.CONFIG)) {
      configSettings.value = { ...defaultConfig }
      lastToast.value = {
        message: 'Configuration was tampered with and has been reset',
        type: 'error'
      }
    }
  }

  // Lifecycle
  onMounted(() => {
    storageEventBus.addEventListener('storage-reset', handleStorageReset)
    storageEventBus.addEventListener('storage-tampered', handleStorageTampered)
  })

  onUnmounted(() => {
    storageEventBus.removeEventListener('storage-reset', handleStorageReset)
    storageEventBus.removeEventListener('storage-tampered', handleStorageTampered)
  })

  // Config operations
  const loadSavedConfig = async () => {
    try {
      const saved = await secureStorageService.get(KEYS.CONFIG)
      
      if (!saved) {
        configSettings.value = { ...defaultConfig }
        return null
      }

      if (!validateConfig(saved)) {
        throw new Error('Invalid configuration format')
      }

      configSettings.value = {
        ...defaultConfig,
        ...saved,
        dns: saved.dns || defaultConfig.dns,
        endpoint: saved.endpoint || defaultConfig.endpoint,
        keepalive: saved.keepalive ?? defaultConfig.keepalive
      }

      return null
    } catch (err) {
      configSettings.value = { ...defaultConfig }
      return { 
        message: 'Config reset due to invalid format. Please reconfigure.',
        type: 'warning'
      }
    }
  }

  const saveConfig = async (newConfig) => {
    try {
      if (!validateConfig(newConfig)) {
        throw new Error('Invalid configuration format')
      }

      const configToSave = {
        ...newConfig,
        dns: newConfig.dns || defaultConfig.dns,
        endpoint: newConfig.endpoint || defaultConfig.endpoint,
        keepalive: newConfig.keepalive ?? defaultConfig.keepalive
      }

      await secureStorageService.set(KEYS.CONFIG, configToSave)
      configSettings.value = configToSave
      return { message: 'Configuration saved successfully', type: 'success' }
    } catch (err) {
      throw new Error(err.message || 'Failed to save configuration')
    }
  }

  const downloadConfig = async (server) => {
    try {
      const config = prepareConfig(server, configSettings.value)
      const blob = new Blob(
        [await apiService.downloadConfig(config)], 
        { type: 'application/x-wireguard-config' }
      )
      
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${server.name}.conf`
      link.click()
      URL.revokeObjectURL(url)
      
      return { message: 'Configuration downloaded', type: 'success' }
    } catch (err) {
      throw new Error(err.message || 'Failed to download configuration')
    }
  }

  const copyConfig = async (server) => {
    try {
      const config = await apiService.generateConfig(
        prepareConfig(server, configSettings.value)
      )
      await navigator.clipboard.writeText(config)
      return { message: 'Configuration copied to clipboard', type: 'success' }
    } catch (err) {
      throw new Error(err.message || 'Failed to copy configuration')
    }
  }

  return {
    configSettings,
    error,
    defaultConfig,
    lastToast,
    loadSavedConfig,
    saveConfig,
    downloadConfig,
    copyConfig
  }
} 