const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const REQUEST_TIMEOUT_MS = 20_000

async function request(endpoint, options = {}) {
  const controller = new AbortController()
  const externalSignal = options.signal
  let abortReason = ''

  const abortFromExternalSignal = () => {
    abortReason = 'cancelled'
    controller.abort()
  }

  if (externalSignal?.aborted) {
    abortFromExternalSignal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
  }

  const timeoutId = setTimeout(() => {
    abortReason = 'timeout'
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const method = options.method?.toUpperCase() || 'GET'
    const headers = new Headers(options.headers)
    const { signal: _externalSignal, ...fetchOptions } = options

    if (method !== 'GET' && options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      let message = `HTTP ${response.status}`

      try {
        const payload = await response.json()
        if (payload?.error) message = payload.error
      } catch {
        message = response.statusText || message
      }

      const error = new Error(message)
      error.status = response.status
      throw error
    }

    if (response.status === 204) {
      return null
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    return contentType.includes('application/json')
      ? response.json()
      : response.text()
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(abortReason === 'timeout' ? 'Request timeout' : 'Request cancelled')
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

export const api = {
  getServers: () => request('/servers'),
  genKey: (token, signal) => request('/key', {
    method: 'POST',
    body: JSON.stringify({ token }),
    signal,
  }),
}