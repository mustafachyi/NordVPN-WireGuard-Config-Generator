/**
 * Utility functions for the application
 */

// Regex patterns
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

// Formatting
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

// Performance
export const debounce = (fn, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => fn(...args), wait)
  }
}

// Validation rules
export const VALIDATION = {
  PRIVATE_KEY: {
    REGEX: PATTERNS.PRIVATE_KEY,
    ERROR: 'Invalid private key format',
    validate: key => !key || PATTERNS.PRIVATE_KEY.test(key)
  },

  DNS: {
    IPV4_REGEX: PATTERNS.IPV4,
    ERROR: 'Invalid IPv4 address',
    validate: dns => {
      if (!dns) return true
      return dns.split(',').every(ip => {
        const trimmedIP = ip.trim()
        return PATTERNS.IPV4.test(trimmedIP) && 
               trimmedIP.split('.').every(num => {
                 const value = parseInt(num)
                 return value >= 0 && value <= 255
               })
      })
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
    ERROR: 'Token must contain only hexadecimal characters (0-9, a-f) and be 64 characters long',
    validate: token => !token || PATTERNS.TOKEN.test(token),
    sanitize: input => {
      if (!input) return ''
      return input.toLowerCase().replace(PATTERNS.NON_HEX, '').slice(0, 64)
    }
  }
} 