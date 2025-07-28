export const storageEventBus = new EventTarget()

const CONFIG = {
  SALT_KEY: 'device_salt',
  LOCAL_STORAGE_KEY_PREFIX: 'config_v2_',
  PBKDF2_ITERATIONS: 250000,
  PBKDF2_HASH: 'SHA-256',
  AES_KEY_ALGORITHM: 'AES-GCM',
  AES_KEY_LENGTH: 256,
  IV_LENGTH_BYTES: 12,
}

class SecureStorageService {
  #derivedKey = null

  #createDeviceIdentifier() {
    return [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      navigator.hardwareConcurrency,
    ].join('|')
  }

  async #getDerivedKey() {
    if (this.#derivedKey) return this.#derivedKey

    let saltBase64 = localStorage.getItem(CONFIG.SALT_KEY)
    if (!saltBase64) {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16))
      saltBase64 = btoa(String.fromCodePoint(...saltBytes))
      localStorage.setItem(CONFIG.SALT_KEY, saltBase64)
    }

    const salt = Uint8Array.from(atob(saltBase64), c => c.codePointAt(0))
    const identifier = this.#createDeviceIdentifier()

    const masterKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(identifier),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    const derived = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: CONFIG.PBKDF2_ITERATIONS,
        hash: CONFIG.PBKDF2_HASH,
      },
      masterKey,
      { name: CONFIG.AES_KEY_ALGORITHM, length: CONFIG.AES_KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    )

    this.#derivedKey = derived
    return this.#derivedKey
  }

  async set(key, value) {
    try {
      const encryptionKey = await this.#getDerivedKey()
      const initializationVector = crypto.getRandomValues(new Uint8Array(CONFIG.IV_LENGTH_BYTES))
      const encodedValue = new TextEncoder().encode(JSON.stringify(value))

      const encryptedData = await crypto.subtle.encrypt(
        { name: CONFIG.AES_KEY_ALGORITHM, iv: initializationVector },
        encryptionKey,
        encodedValue
      )

      const combinedData = new Uint8Array(initializationVector.length + encryptedData.byteLength)
      combinedData.set(initializationVector)
      combinedData.set(new Uint8Array(encryptedData), initializationVector.length)

      const base64String = btoa(String.fromCodePoint(...combinedData))
      localStorage.setItem(CONFIG.LOCAL_STORAGE_KEY_PREFIX + key, base64String)
    } catch (error) {
      console.error('Failed to set value in secure storage:', error)
    }
  }

  async get(key) {
    const fullKey = CONFIG.LOCAL_STORAGE_KEY_PREFIX + key
    const base64String = localStorage.getItem(fullKey)
    if (!base64String) return null

    try {
      const encryptionKey = await this.#getDerivedKey()
      const binaryData = Uint8Array.from(atob(base64String), c => c.codePointAt(0))
      const initializationVector = binaryData.slice(0, CONFIG.IV_LENGTH_BYTES)
      const encryptedContent = binaryData.slice(CONFIG.IV_LENGTH_BYTES)

      const decryptedData = await crypto.subtle.decrypt(
        { name: CONFIG.AES_KEY_ALGORITHM, iv: initializationVector },
        encryptionKey,
        encryptedContent
      )

      return JSON.parse(new TextDecoder().decode(decryptedData))
    } catch (error) {
      localStorage.removeItem(fullKey)
      storageEventBus.dispatchEvent(
        new CustomEvent('storage-tampered', {
          detail: { invalidKeys: [key] },
        })
      )
      return null
    }
  }

  remove(key) {
    localStorage.removeItem(CONFIG.LOCAL_STORAGE_KEY_PREFIX + key)
  }
}

export default new SecureStorageService()