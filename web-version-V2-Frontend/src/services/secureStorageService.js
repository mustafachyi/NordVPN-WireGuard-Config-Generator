/**
 * Secure storage service for encrypting sensitive data in localStorage
 */

// Custom event bus for storage events
export const storageEventBus = new EventTarget()

class SecureStorageService {
  #ready = false
  #encKey = null
  #prefix = 'secure_'
  #initPromise = null
  #storage = localStorage

  constructor() {
    this.#initPromise = null
  }

  #lazyInit() {
    if (!this.#initPromise) {
      this.#initPromise = this.#init().catch(console.error)
    }
    return this.#initPromise
  }

  async #init() {
    if (this.#ready) return

    const [mainKey] = await Promise.all([
      this.#deriveKey(false),
      this.#deriveKey(true) 
    ])

    this.#encKey = mainKey
    this.#ready = true
  }

  #getFingerprint() {
    const gl = document.createElement('canvas')
      .getContext('webgl') || 
      document.createElement('canvas')
      .getContext('experimental-webgl')

    if (!gl) throw new Error('WebGL not supported')

    const props = [
      gl.VERSION,
      gl.SHADING_LANGUAGE_VERSION,
      gl.VENDOR,
      gl.RENDERER,
      gl.MAX_TEXTURE_SIZE,
      gl.MAX_RENDERBUFFER_SIZE,
      gl.MAX_VERTEX_ATTRIBS
    ].map(k => gl.getParameter(k))

    props.push(gl.getSupportedExtensions().join())
    return props.join('|')
  }

  async #deriveKey(useBackup) {
    const data = this.#getFingerprint()
    const input = useBackup ? [...data].reverse().join('') : data

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    )

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(`nord-${useBackup ? 'backup' : 'main'}`),
        iterations: 110000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    )

    const mixed = new Uint8Array(bits)
    for (let i = 0; i < mixed.length; i++) {
      mixed[i] ^= mixed[(i + 1) % mixed.length]
    }

    return crypto.subtle.importKey(
      'raw',
      mixed,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    )
  }

  async #encrypt(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.#encKey,
      new TextEncoder().encode(JSON.stringify(value))
    )

    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    this.#storage.setItem(
      this.#prefix + key,
      btoa(String.fromCharCode(...combined))
    )
  }

  async #decrypt(key) {
    const data = this.#storage.getItem(this.#prefix + key)
    if (!data) return null

    const binary = new Uint8Array(atob(data).split('').map(c => c.charCodeAt(0)))
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: binary.slice(0, 12) },
      this.#encKey,
      binary.slice(12)
    )

    return JSON.parse(new TextDecoder().decode(decrypted))
  }

  async set(key, value) {
    try {
      if (!this.#ready) await this.#lazyInit()
      await this.#encrypt(key, value)
      storageEventBus.dispatchEvent(new CustomEvent('storage', { detail: { key } }))
      return true
    } catch {
      return false
    }
  }

  async get(key) {
    try {
      if (!this.#ready) await this.#lazyInit()
      return await this.#decrypt(key)
    } catch {
      return null
    }
  }

  remove(key) {
    this.#storage.removeItem(this.#prefix + key)
    storageEventBus.dispatchEvent(new CustomEvent('storage', { detail: { key } }))
  }
  
  clear() {
    Object.keys(this.#storage)
      .filter(k => k.startsWith(this.#prefix))
      .forEach(k => this.#storage.removeItem(k))
    storageEventBus.dispatchEvent(new CustomEvent('storage'))
  }
}

export default new SecureStorageService() 