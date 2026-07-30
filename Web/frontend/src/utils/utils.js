const RX = {
  WORD: /^([a-z]+)(\d+)?$/i,
  IPV4: /^(\d{1,3}\.){3}\d{1,3}$/,
  KEY: /^[A-Za-z0-9+/]{43}=$/,
  TOKEN: /^[a-f0-9]{64}$/i,
  HEX: /[^a-f0-9]/g,
}

const isEmpty = value => value === '' || value === null || value === undefined

export const formatName = value => {
  if (!value) return ''

  return value.split('_').map(part => {
    const [, word, number] = part.match(RX.WORD) || [null, part]
    return word.charAt(0).toUpperCase() + word.slice(1) + (number ? ` ${number}` : '')
  }).join(' ')
}

export const Validators = {
  Key: {
    valid: value => isEmpty(value) || (typeof value === 'string' && RX.KEY.test(value)),
    err: 'Invalid private key format',
  },
  DNS: {
    valid: value => isEmpty(value) || (
      typeof value === 'string'
      && value.split(',').every(address => {
        const trimmedAddress = address.trim()
        return RX.IPV4.test(trimmedAddress) && trimmedAddress.split('.').every(segment => {
          const number = Number(segment)
          return Number.isInteger(number) && number >= 0 && number <= 255
        })
      })
    ),
    err: 'Invalid IPv4 address',
  },
  Endpoint: {
    valid: value => value === 'hostname' || value === 'station',
    err: 'Invalid endpoint type',
  },
  Keepalive: {
    valid: value => {
      if (isEmpty(value)) return false
      const number = Number(value)
      return Number.isInteger(number) && number >= 15 && number <= 120
    },
    min: 15,
    max: 120,
    err: 'Must be between 15 and 120',
  },
  Token: {
    valid: value => isEmpty(value) || (typeof value === 'string' && RX.TOKEN.test(value)),
    clean: value => value ? value.toLowerCase().replace(RX.HEX, '').slice(0, 64) : '',
    err: 'Token must be 64 hexadecimal characters',
  },
}