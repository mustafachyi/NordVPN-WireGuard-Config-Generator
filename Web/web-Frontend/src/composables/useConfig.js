import { ref } from 'vue'
import { api } from '@/services/apiService'
import { storage } from '@/services/storageService'
import { Validators, sanitizeName } from '@/utils/utils'

const KEY = 'wg_gen_settings'
const DEF = { dns: '103.86.96.100', endpoint: 'hostname', keepalive: 25 }

export function useConfig() {
  const privKey = ref('')
  const settings = ref({ ...DEF })

  const load = () => {
    const s = storage.get(KEY)
    if (s && Validators.DNS.valid(s.dns) && Validators.Keepalive.valid(s.keepalive)) {
      settings.value = {
        dns: s.dns ?? DEF.dns,
        endpoint: s.endpoint ?? DEF.endpoint,
        keepalive: s.keepalive ?? DEF.keepalive
      }
    }
  }

  const save = s => {
    const next = {
      dns: s.dns ?? settings.value.dns,
      endpoint: s.endpoint ?? settings.value.endpoint,
      keepalive: s.keepalive ?? settings.value.keepalive
    }
    
    if (Validators.DNS.valid(next.dns) && Validators.Keepalive.valid(next.keepalive)) {
      storage.set(KEY, next)
      settings.value = next
    }
  }

  const make = s => ({
    country: sanitizeName(s.country),
    city: sanitizeName(s.city),
    name: s.name,
    privateKey: privKey.value,
    dns: settings.value.dns,
    endpoint: settings.value.endpoint,
    keepalive: settings.value.keepalive
  })

  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const dl = async s => {
    const { blob, name } = await api.dlConfig(make(s))
    saveBlob(blob, name || `${s.name}.conf`)
  }

  const dlBatch = async (filters = {}) => {
    const body = {
      privateKey: privKey.value,
      dns: settings.value.dns,
      endpoint: settings.value.endpoint,
      keepalive: settings.value.keepalive,
      country: filters.country || '',
      city: filters.city || ''
    }
    const { blob, name } = await api.dlBatch(body)
    saveBlob(blob, name)
  }

  return {
    privKey,
    settings,
    defaults: DEF,
    load,
    save,
    setKey: k => { if (Validators.Key.valid(k)) privKey.value = k; else throw new Error(Validators.Key.err) },
    dl,
    dlBatch,
    copy: async s => navigator.clipboard.writeText(await api.genConfig(make(s))),
    make
  }
}