import { ref, computed, toRefs } from 'vue'
import { apiService } from '../services/apiService'
import { formatDisplayName } from '../utils/utils'

// Constants
const CHUNK_SIZE = 100
const SORT_FUNCTIONS = {
  load: (a, b) => a.load - b.load,
  country: (a, b) => a.displayCountry.localeCompare(b.displayCountry),
  city: (a, b) => a.displayCity.localeCompare(b.displayCity),
  name: (a, b) => a.displayName.localeCompare(b.displayName)
}

/**
 * Creates a server object with formatted display properties
 * @param {Object} server - The server data
 * @param {string} country - The country name
 * @param {string} city - The city name
 * @returns {Object} Formatted server object
 */
const formatServer = (server, country, city) => ({
  ...server,
  country,
  city,
  displayName: formatDisplayName(server.name),
  displayCountry: formatDisplayName(country),
  displayCity: formatDisplayName(city)
})

/**
 * Composable for managing server data and filtering
 * @returns {Object} Server state and methods
 */
export function useServers() {
  // Server State Management
  const state = ref({
    allServers: [],
    visibleServers: [],
    isLoading: false,
    sortBy: 'name',
    sortOrder: 'asc',
    filterCountry: '',
    filterCity: ''
  })

  const {
    allServers,
    visibleServers,
    isLoading,
    sortBy,
    sortOrder,
    filterCountry,
    filterCity
  } = toRefs(state.value)

  // Lists
  const getUniqueValues = (key) => computed(() => 
    [...new Set(allServers.value.map(s => s[key]))].sort()
  )

  const countries = getUniqueValues('country')
  const cities = getUniqueValues('city')
  const citiesForCountry = computed(() => 
    filterCountry.value 
      ? [...new Set(
          allServers.value
            .filter(s => s.country === filterCountry.value)
            .map(s => s.city)
        )].sort()
      : []
  )

  // Filtering and sorting
  const sortedServers = computed(() => {
    try {
      let servers = allServers.value

      // Apply filters
      if (filterCountry.value || filterCity.value) {
        servers = servers.filter(s => 
          (!filterCountry.value || s.country === filterCountry.value) &&
          (!filterCity.value || s.city === filterCity.value)
        )
      }

      // Apply sort
      const compare = SORT_FUNCTIONS[sortBy.value] || SORT_FUNCTIONS.name
      const multiplier = sortOrder.value === 'asc' ? 1 : -1
      return servers.sort((a, b) => compare(a, b) * multiplier)
    } catch (err) {
      return []
    }
  })

  const filteredCount = computed(() => sortedServers.value.length)

  // Methods
  const updateVisibleServers = () => {
    visibleServers.value = sortedServers.value.slice(0, CHUNK_SIZE)
  }

  const loadMoreServers = () => {
    if (!isLoading.value) {
      const start = visibleServers.value.length
      const chunk = sortedServers.value.slice(start, start + CHUNK_SIZE)
      chunk.length && visibleServers.value.push(...chunk)
    }
  }

  const toggleSort = (newSortBy) => {
    if (sortBy.value === newSortBy) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortBy.value = newSortBy
      sortOrder.value = 'asc'
    }
  }

  const loadServers = async () => {
    try {
      isLoading.value = true
      const data = await apiService.getServers()
      
      // Transform server data
      allServers.value = Object.entries(data).flatMap(([country, cities]) => 
        Object.entries(cities).flatMap(([city, servers]) =>
          servers.map(server => formatServer(server, country, city))
        )
      )
      
      updateVisibleServers()
    } catch (err) {
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return {
    // State
    allServers,
    visibleServers,
    isLoading,
    sortBy,
    sortOrder,
    filterCountry,
    filterCity,
    
    // Computed
    countries,
    cities,
    citiesForCountry,
    sortedServers,
    filteredCount,
    
    // Methods
    updateVisibleServers,
    loadMoreServers,
    toggleSort,
    loadServers
  }
} 