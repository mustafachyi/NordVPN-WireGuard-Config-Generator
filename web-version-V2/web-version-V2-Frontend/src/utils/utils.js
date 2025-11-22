const RX = {
  WORD: /^([a-z]+)(\d+)?$/i,
  NAME: /[\/\\:*?"<>|#]/g,
  MULTI: /_+/g,
  TRIM: /^_|_$/g,
  IPV4: /^(\d{1,3}\.){3}\d{1,3}$/,
  KEY: /^[A-Za-z0-9+/]{43}=$/,
  TOKEN: /^[a-f0-9]{64}$/i,
  HEX: /[^a-f0-9]/g
}

export const formatName = s => {
  if (!s) return ''
  return s.split('_').map(p => {
    const [, w, n] = p.match(RX.WORD) || [null, p]
    return w.charAt(0).toUpperCase() + w.slice(1) + (n ? ` ${n}` : '')
  }).join(' ')
}

export const sanitizeName = s => s.toLowerCase()
  .replace(RX.NAME, '_')
  .replace(RX.MULTI, '_')
  .replace(RX.TRIM, '')

export const Validators = {
  Key: {
    valid: k => !k || RX.KEY.test(k),
    err: 'Invalid private key format'
  },
  DNS: {
    valid: d => !d || d.split(',').every(ip => {
      const t = ip.trim()
      return RX.IPV4.test(t) && t.split('.').every(n => {
        const i = parseInt(n, 10)
        return i >= 0 && i <= 255
      })
    }),
    err: 'Invalid IPv4 address'
  },
  Keepalive: {
    valid: v => !v || (!isNaN(v) && v >= 15 && v <= 120),
    min: 15,
    max: 120,
    err: 'Must be between 15 and 120'
  },
  Token: {
    valid: t => !t || RX.TOKEN.test(t),
    clean: t => t ? t.toLowerCase().replace(RX.HEX, '').slice(0, 64) : '',
    err: 'Token must be 64 hex characters'
  }
}