import { computed, markRaw, shallowRef, watch } from 'vue'
import { api } from '@/services/apiService'
import { formatName } from '@/utils/utils'

const PAGE_SIZE = 24
const PUBLIC_KEY_CHUNK_LENGTH = 43
const PUBLIC_KEY_COLLECTION_PATTERN = /^(?:[A-Za-z0-9+/]{43})+$/
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/
const SAFE_HOSTNAME_PATTERN = /^[A-Za-z0-9.-]+$/
const SAFE_SUFFIX_PATTERN = /^[_A-Za-z0-9.-]*$/
const SERVER_GROUPS = [
  { id: 1, name: 'Standard' },
  { id: 2, name: 'P2P' },
  { id: 4, name: 'Dedicated IP' },
  { id: 8, name: 'Onion Over VPN' },
  { id: 16, name: 'Double VPN' },
]

const isGroupMatch = (mask, group) => {
  if (!group) return true
  if (!(mask & group)) return false
  if (group !== 4 && (mask & 4)) return false
  return true
}

const isNonNegativeInteger = value => Number.isInteger(value) && value >= 0

let instance = null

export function useServers() {
  if (instance) return instance

  const allServers = shallowRef([])
  const loading = shallowRef(false)
  const error = shallowRef('')
  const sortField = shallowRef('name')
  const sortOrder = shallowRef('asc')
  const selectedGroup = shallowRef('')
  const selectedCountry = shallowRef('')
  const selectedCity = shallowRef('')
  const visibleLimit = shallowRef(PAGE_SIZE)

  const availableCountries = computed(() => {
    const group = Number.parseInt(selectedGroup.value, 10) || 0
    const countries = new Map()

    for (const server of allServers.value) {
      if (isGroupMatch(server.groupMask, group) && !countries.has(server.country)) {
        countries.set(server.country, {
          id: server.country,
          name: server.displayCountry,
        })
      }
    }

    return Array.from(countries.values())
      .sort((first, second) => first.name.localeCompare(second.name))
  })

  const availableCities = computed(() => {
    if (!selectedCountry.value) return []

    const group = Number.parseInt(selectedGroup.value, 10) || 0
    const cities = new Map()

    for (const server of allServers.value) {
      if (
        server.country === selectedCountry.value
        && isGroupMatch(server.groupMask, group)
        && !cities.has(server.city)
      ) {
        cities.set(server.city, {
          id: server.city,
          name: server.displayCity,
        })
      }
    }

    return Array.from(cities.values())
      .sort((first, second) => first.name.localeCompare(second.name))
  })

  watch(availableCountries, countries => {
    if (
      selectedCountry.value
      && !countries.some(country => country.id === selectedCountry.value)
    ) {
      selectedCountry.value = ''
    }
  })

  watch(availableCities, cities => {
    if (cities.length === 1) {
      selectedCity.value = cities[0].id
    } else if (
      selectedCity.value
      && !cities.some(city => city.id === selectedCity.value)
    ) {
      selectedCity.value = ''
    }
  })

  const filteredServers = computed(() => {
    const group = Number.parseInt(selectedGroup.value, 10) || 0
    const country = selectedCountry.value
    const city = selectedCity.value
    let servers = allServers.value

    if (group) servers = servers.filter(server => isGroupMatch(server.groupMask, group))
    if (country) servers = servers.filter(server => server.country === country)
    if (city) servers = servers.filter(server => server.city === city)

    const direction = sortOrder.value === 'asc' ? 1 : -1

    return servers.slice().sort((first, second) => {
      if (sortField.value === 'load') {
        const loadDifference = first.load - second.load
        if (loadDifference !== 0) return loadDifference * direction
      }

      return first.displayName.localeCompare(second.displayName) * direction
    })
  })

  const visibleServers = computed(() => filteredServers.value.slice(0, visibleLimit.value))
  const serverCount = computed(() => filteredServers.value.length)
  const selectedGroupName = computed(() =>
    SERVER_GROUPS.find(
      group => group.id === Number.parseInt(selectedGroup.value, 10),
    )?.name || ''
  )

  const resetVisibleServers = () => {
    visibleLimit.value = PAGE_SIZE
    window.scrollTo(0, 0)
  }

  watch(
    [selectedGroup, selectedCountry, selectedCity, sortField, sortOrder],
    resetVisibleServers,
  )

  const processServerData = payload => {
    if (
      !Array.isArray(payload)
      || payload.length !== 2
      || typeof payload[0] !== 'string'
      || !Array.isArray(payload[1])
      || !PUBLIC_KEY_COLLECTION_PATTERN.test(payload[0])
    ) {
      throw new Error('Invalid server catalog')
    }

    const [keyCollection, rawCountries] = payload
    const publicKeys = []

    for (let index = 0; index < keyCollection.length; index += PUBLIC_KEY_CHUNK_LENGTH) {
      publicKeys.push(`${keyCollection.slice(index, index + PUBLIC_KEY_CHUNK_LENGTH)}=`)
    }

    const servers = []
    const formattedNameCache = new Map()

    const getFormattedName = value => {
      if (formattedNameCache.has(value)) return formattedNameCache.get(value)

      const formattedValue = formatName(value)
      formattedNameCache.set(value, formattedValue)
      return formattedValue
    }

    for (const countryData of rawCountries) {
      if (
        !Array.isArray(countryData)
        || countryData.length !== 3
        || typeof countryData[0] !== 'string'
        || typeof countryData[1] !== 'string'
        || !Array.isArray(countryData[2])
      ) {
        throw new Error('Invalid country data')
      }

      const [countryName, countryCode, cities] = countryData
      if (!SAFE_IDENTIFIER_PATTERN.test(countryCode)) {
        throw new Error('Invalid country code')
      }

      const displayCountry = getFormattedName(countryName)
      const hostnamePrefix = countryCode === 'gb' ? 'uk' : countryCode

      for (const cityData of cities) {
        if (
          !Array.isArray(cityData)
          || cityData.length < 3
          || typeof cityData[0] !== 'string'
          || !isNonNegativeInteger(cityData[1])
          || !isNonNegativeInteger(cityData[2])
        ) {
          throw new Error('Invalid city data')
        }

        const cityName = cityData[0]
        const defaultKeyIndex = cityData[1]
        const defaultGroupMask = cityData[2]
        const displayCity = getFormattedName(cityName)
        const lastValue = cityData[cityData.length - 1]
        const hasExceptions = Array.isArray(lastValue)
        const exceptions = hasExceptions ? lastValue : []
        const dataLength = hasExceptions ? cityData.length - 1 : cityData.length

        if ((dataLength - 3) % 2 !== 0) {
          throw new Error('Invalid packed server data')
        }

        let lastIp = 0
        let lastServerNumber = 0
        let exceptionIndex = 0

        for (let index = 3; index < dataLength; index += 2) {
          const packedValue = cityData[index]
          const ipDelta = cityData[index + 1]

          if (!Number.isInteger(packedValue) || !Number.isInteger(ipDelta)) {
            throw new Error('Invalid server data')
          }

          lastIp = (lastIp + ipDelta) >>> 0
          const ip = [
            (lastIp >>> 24) & 255,
            (lastIp >>> 16) & 255,
            (lastIp >>> 8) & 255,
            lastIp & 255,
          ].join('.')

          const load = packedValue & 0x7f
          const isException = packedValue < 0
          let hostnameOverride = ''
          let deduplicationSuffix = ''
          let keyIndex = defaultKeyIndex
          let groupMask = defaultGroupMask
          let serverNumber
          let isNumericServerNumber = true

          if (isException) {
            const exception = exceptions[exceptionIndex++]
            if (!Array.isArray(exception) || exception.length === 0) {
              throw new Error('Invalid server exception data')
            }

            const identifier = exception[0]
            if (isNonNegativeInteger(identifier)) {
              lastServerNumber = identifier
              serverNumber = String(identifier)
            } else if (
              typeof identifier === 'string'
              && SAFE_IDENTIFIER_PATTERN.test(identifier)
            ) {
              serverNumber = identifier
              isNumericServerNumber = false
            } else {
              throw new Error('Invalid server identifier')
            }

            if (exception.length > 1 && exception[1] !== -1) {
              if (!isNonNegativeInteger(exception[1])) {
                throw new Error('Invalid public key reference')
              }

              keyIndex = exception[1]
            }

            if (exception.length > 2 && exception[2] !== -1) {
              if (!isNonNegativeInteger(exception[2])) {
                throw new Error('Invalid server group')
              }

              groupMask = exception[2]
            }

            if (exception.length > 3 && exception[3]) {
              if (
                typeof exception[3] !== 'string'
                || !SAFE_HOSTNAME_PATTERN.test(exception[3])
              ) {
                throw new Error('Invalid server hostname')
              }

              hostnameOverride = exception[3]
            }

            if (exception.length > 4 && exception[4]) {
              if (
                typeof exception[4] !== 'string'
                || !SAFE_SUFFIX_PATTERN.test(exception[4])
              ) {
                throw new Error('Invalid server suffix')
              }

              deduplicationSuffix = exception[4]
            }
          } else {
            lastServerNumber += packedValue >> 7
            serverNumber = String(lastServerNumber)
          }

          const publicKey = publicKeys[keyIndex]
          if (!publicKey) {
            throw new Error('Invalid public key reference')
          }

          const baseHostname = isNumericServerNumber
            ? `${hostnamePrefix}${serverNumber}`
            : serverNumber
          const endpoint = hostnameOverride || `${baseHostname}.nordvpn.com`
          const fileName = `${baseHostname}${deduplicationSuffix}.conf`
          const displaySuffix = deduplicationSuffix.replaceAll('_', ' ').trim()
          const displayName = `${displayCountry} ${serverNumber}${displaySuffix ? ` (${displaySuffix})` : ''}`

          servers.push(markRaw({
            load,
            ip,
            publicKey,
            endpoint,
            fileName,
            country: countryName,
            city: cityName,
            displayName,
            displayCountry,
            displayCity,
            groupMask,
          }))
        }

        if (exceptionIndex !== exceptions.length) {
          throw new Error('Invalid server exception count')
        }
      }
    }

    allServers.value = servers
  }

  const initialize = async () => {
    loading.value = true
    error.value = ''

    try {
      processServerData(await api.getServers())
    } catch (initializationError) {
      error.value = initializationError.message || 'Failed to load servers'
      console.error(initializationError)
    } finally {
      loading.value = false
    }
  }

  instance = {
    filteredServers,
    visibleServers,
    loading,
    error,
    sortField,
    sortOrder,
    selectedGroup,
    selectedCountry,
    selectedCity,
    serverGroups: SERVER_GROUPS,
    availableCountries,
    availableCities,
    serverCount,
    selectedGroupName,
    loadMore: () => {
      if (!loading.value && visibleLimit.value < serverCount.value) {
        visibleLimit.value += PAGE_SIZE
      }
    },
    toggleSort: field => {
      if (sortField.value === field) {
        sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
      } else {
        sortField.value = field
        sortOrder.value = 'asc'
      }
    },
    initialize,
  }

  return instance
}