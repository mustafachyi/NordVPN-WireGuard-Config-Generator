import { ref } from 'vue'
import { generate } from 'lean-qr'
import { toSvgSource } from 'lean-qr/extras/svg'
import { storage } from '@/services/storageService'
import { Validators } from '@/utils/utils'
import { createZipArchive } from '@/utils/zip'

const SETTINGS_STORAGE_KEY = 'wg_gen_settings'
const DEFAULT_SETTINGS = {
  dns: '103.86.96.100',
  endpoint: 'hostname',
  keepalive: 25,
}
const ARCHIVE_SEGMENT_PATTERN = /[\u0000-\u001f<>:"/\\|?*]/g
const COMBINATION_FOLDERS = Array.from({ length: 32 }, (_, mask) => {
  const names = []
  if (mask & 1) names.push('Standard')
  if (mask & 2) names.push('P2P')
  if (mask & 4) names.push('Dedicated_IP')
  if (mask & 8) names.push('Onion_Over_VPN')
  if (mask & 16) names.push('Double_VPN')
  return names.length > 0 ? names.join('_') : 'Unknown'
})

function buildWireGuardConfig(privateKey, dns, publicKey, endpoint, keepalive) {
  return `[Interface]
PrivateKey=${privateKey || ''}
Address=10.5.0.2/16
DNS=${dns}

[Peer]
PublicKey=${publicKey}
AllowedIPs=0.0.0.0/0,::/0
Endpoint=${endpoint}:51820
PersistentKeepalive=${keepalive}`
}

function sanitizeArchiveSegment(value, fallback) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(ARCHIVE_SEGMENT_PATTERN, '_')
    .replace(/\.\./g, '_')
    .replace(/[. ]+$/g, '')
    .trim()

  return normalized || fallback
}

function buildBatchFilePath(batchGroup, batchCountry, batchCity, server) {
  const fileName = sanitizeArchiveSegment(server.fileName, 'server.conf')
  const country = sanitizeArchiveSegment(server.country, 'Unknown_Country')
  const city = sanitizeArchiveSegment(server.city, 'Unknown_City')
  const geoPath = batchCity !== ''
    ? fileName
    : batchCountry === ''
      ? `${country}/${city}/${fileName}`
      : `${city}/${fileName}`

  if (batchGroup !== '') {
    return geoPath
  }

  const groupFolder = COMBINATION_FOLDERS[server.groupMask] || 'Unknown'
  return `${groupFolder}/${geoPath}`
}

function normalizeStoredSettings(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }

  const keepalive = Validators.Keepalive.valid(value.keepalive)
    ? Number(value.keepalive)
    : DEFAULT_SETTINGS.keepalive

  return {
    dns: typeof value.dns === 'string' && Validators.DNS.valid(value.dns)
      ? value.dns
      : DEFAULT_SETTINGS.dns,
    endpoint: Validators.Endpoint.valid(value.endpoint)
      ? value.endpoint
      : DEFAULT_SETTINGS.endpoint,
    keepalive,
  }
}

let instance = null

export function useConfig() {
  if (instance) return instance

  const privateKey = ref('')
  const settings = ref({ ...DEFAULT_SETTINGS })

  const load = () => {
    settings.value = normalizeStoredSettings(storage.get(SETTINGS_STORAGE_KEY))
  }

  const resolveSettings = value => {
    const nextSettings = {
      dns: value.dns ?? settings.value.dns,
      endpoint: value.endpoint ?? settings.value.endpoint,
      keepalive: Number(value.keepalive ?? settings.value.keepalive),
    }

    if (!Validators.DNS.valid(nextSettings.dns)) {
      throw new Error(Validators.DNS.err)
    }

    if (!Validators.Endpoint.valid(nextSettings.endpoint)) {
      throw new Error(Validators.Endpoint.err)
    }

    if (!Validators.Keepalive.valid(nextSettings.keepalive)) {
      throw new Error(Validators.Keepalive.err)
    }

    return nextSettings
  }

  const applyConfiguration = value => {
    const nextPrivateKey = value.privateKey ?? privateKey.value
    if (typeof nextPrivateKey !== 'string' || !Validators.Key.valid(nextPrivateKey)) {
      throw new Error(Validators.Key.err)
    }

    const nextSettings = resolveSettings(value)
    if (!storage.set(SETTINGS_STORAGE_KEY, nextSettings)) {
      throw new Error('Settings could not be saved')
    }

    privateKey.value = nextPrivateKey
    settings.value = nextSettings
  }

  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  const buildText = server => buildWireGuardConfig(
    privateKey.value,
    settings.value.dns,
    server.publicKey,
    settings.value.endpoint === 'station' ? server.ip : server.endpoint,
    settings.value.keepalive,
  )

  const download = server => {
    const blob = new Blob([buildText(server)], { type: 'application/x-wireguard-config' })
    saveBlob(blob, sanitizeArchiveSegment(server.fileName, 'server.conf'))
  }

  const downloadBatch = (servers, filters = {}) => {
    const targetGroup = filters.group || ''
    const targetCountry = filters.country || ''
    const targetCity = filters.city || ''

    if (!Array.isArray(servers) || servers.length === 0) {
      throw new Error('No configurations found')
    }

    const archiveParts = ['NordVPN']
    if (targetGroup) archiveParts.push(sanitizeArchiveSegment(targetGroup, 'Group'))
    if (targetCountry) archiveParts.push(sanitizeArchiveSegment(targetCountry, 'Country'))
    if (targetCity) archiveParts.push(sanitizeArchiveSegment(targetCity, 'City'))
    if (archiveParts.length === 1) archiveParts.push('All')

    const encoder = new TextEncoder()
    const entries = servers.map(server => ({
      name: buildBatchFilePath(targetGroup, targetCountry, targetCity, server),
      data: encoder.encode(buildText(server)),
    }))

    const archive = createZipArchive(entries)
    saveBlob(
      new Blob([archive], { type: 'application/zip' }),
      `${archiveParts.join('_')}.zip`,
    )
  }

  const copy = server => navigator.clipboard.writeText(buildText(server))

  const getQrBlob = server => {
    const code = generate(buildText(server))
    const svgText = toSvgSource(code, {
      on: '#000000',
      off: '#ffffff',
      pad: 1,
      width: 256,
    })

    return new Blob([svgText], { type: 'image/svg+xml' })
  }

  instance = {
    privateKey,
    settings,
    defaults: DEFAULT_SETTINGS,
    load,
    applyConfiguration,
    setKey: value => {
      if (typeof value !== 'string' || !Validators.Key.valid(value)) {
        throw new Error(Validators.Key.err)
      }

      privateKey.value = value
    },
    buildText,
    download,
    downloadBatch,
    copy,
    getQrBlob,
  }

  return instance
}