const PATTERNS = {
  WORD_NUMBER: /^([a-z]+)(\d+)?$/i,
  SERVER_NAME: /[\/\\:*?"<>|#]/g,
  MULTIPLE_UNDERSCORES: /_+/g,
  EDGE_UNDERSCORES: /^_|_$/g,
  IPV4: /^(\d{1,3}\.){3}\d{1,3}$/,
  PRIVATE_KEY: /^[A-Za-z0-9+/]{43}=$/,
  TOKEN: /^[a-f0-9]{64}$/i,
  NON_HEX: /[^a-f0-9]/g
}

export const formatDisplayName = str => {
  if (!str) return ''
  return str.split('_').map(part => {
    const [, word, num] = part.match(PATTERNS.WORD_NUMBER) || [null, part]
    return word.charAt(0).toUpperCase() + word.slice(1) + (num ? ` ${num}` : '')
  }).join(' ')
}

export const sanitizeServerName = str => str.toLowerCase()
  .replace(PATTERNS.SERVER_NAME, '_')
  .replace(PATTERNS.MULTIPLE_UNDERSCORES, '_')
  .replace(PATTERNS.EDGE_UNDERSCORES, '')

export const debounce = (fn, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => fn(...args), wait)
  }
}

export const VALIDATION = {
  PRIVATE_KEY: {
    REGEX: PATTERNS.PRIVATE_KEY,
    ERROR: 'Invalid private key format',
    validate: key => !key || PATTERNS.PRIVATE_KEY.test(key)
  },

  DNS: {
    ERROR: 'Invalid IPv4 address',
    validate: dns => {
      if (!dns) return true
      const isSegmentValid = num => parseInt(num, 10) >= 0 && parseInt(num, 10) <= 255
      const isIpValid = ip => {
        const trimmed = ip.trim()
        return PATTERNS.IPV4.test(trimmed) && trimmed.split('.').every(isSegmentValid)
      }
      return dns.split(',').every(isIpValid)
    }
  },

  KEEPALIVE: {
    MIN: 15,
    MAX: 120,
    ERROR: 'Must be between 15 and 120',
    validate: value => {
      if (!value) return true
      const num = parseInt(value)
      return !isNaN(num) && num >= VALIDATION.KEEPALIVE.MIN && num <= VALIDATION.KEEPALIVE.MAX
    }
  },

  TOKEN: {
    REGEX: PATTERNS.TOKEN,
    ERROR: 'Token must be 64 hexadecimal characters.',
    validate: token => !token || PATTERNS.TOKEN.test(token),
    sanitize: input => {
      if (!input) return ''
      return input.toLowerCase().replace(PATTERNS.NON_HEX, '').slice(0, 64)
    }
  }
}