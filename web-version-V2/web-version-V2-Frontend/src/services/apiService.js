const BASE = '/api'
const TIMEOUT = 10000
const MIME = { json: 'application/json', wg: 'application/x-wireguard-config', img: 'image/' }

async function req(end, opt = {}) {
  const c = new AbortController()
  const id = setTimeout(() => c.abort(), TIMEOUT)
  try {
    const r = await fetch(`${BASE}${end}`, {
      ...opt,
      headers: { 'Content-Type': MIME.json, ...opt.headers },
      signal: c.signal
    })
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`)
      e.status = r.status
      throw e
    }
    const t = r.headers.get('content-type') || ''
    if (t.includes(MIME.wg) || t.startsWith(MIME.img)) return r
    return t.includes(MIME.json) ? r.json() : r.text()
  } catch (e) {
    throw e.name === 'AbortError' ? new Error('Request timeout') : e
  } finally {
    clearTimeout(id)
  }
}

export const api = {
  genKey: token => req('/key', { method: 'POST', body: JSON.stringify({ token }) }),
  genConfig: data => req('/config', { method: 'POST', body: JSON.stringify(data) }),
  dlConfig: async data => {
    const r = await req('/config/download', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Accept': MIME.wg }
    })
    const m = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')
    return { blob: await r.blob(), name: m?.[1] || null }
  },
  genQR: async data => {
    const r = await req('/config/qr', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Accept': MIME.img }
    })
    return r.blob()
  }
}