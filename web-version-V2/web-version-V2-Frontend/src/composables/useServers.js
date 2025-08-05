import { ref, computed, watch } from 'vue'
import { apiService } from '@/services/apiService'
import { formatDisplayName } from '@/utils/utils'

const VISIBLE_SERVER_INCREMENT = 24

const SORT_FUNCTIONS = {
  load: (a, b) => a.load - b.load,
  name: (a, b) => a.displayName.localeCompare(b.displayName),
}

const createServerViewModel = (server, country, city) => ({
  ...server,
  country,
  city,
  displayName: formatDisplayName(server.name),
  displayCountry: formatDisplayName(country),
  displayCity: formatDisplayName(city),
})

export function useServers() {
  const allServers = ref([])
  const isLoading = ref(false)
  const sortBy = ref('name')
  const sortOrder = ref('asc')
  const filterCountry = ref('')
  const filterCity = ref('')
  const visibleCount = ref(VISIBLE_SERVER_INCREMENT)

  const countries = computed(() =>
    [...new Set(allServers.value.map(s => s.country))].sort()
  )

  const citiesForCountry = computed(() =>
    filterCountry.value
      ? [...new Set(allServers.value.filter(s => s.country === filterCountry.value).map(s => s.city))].sort()
      : []
  )

  const processedServers = computed(() => {
    const servers = allServers.value.filter(s =>
      (!filterCountry.value || s.country === filterCountry.value) &&
      (!filterCity.value || s.city === filterCity.value)
    )
    
    const compareFunction = SORT_FUNCTIONS[sortBy.value] || SORT_FUNCTIONS.name
    const sortMultiplier = sortOrder.value === 'asc' ? 1 : -1
    
    return servers.sort((a, b) => compareFunction(a, b) * sortMultiplier)
  })

  const visibleServers = computed(() => processedServers.value.slice(0, visibleCount.value))
  
  const filteredCount = computed(() => processedServers.value.length)
  
  const resetVisibleState = () => {
    visibleCount.value = VISIBLE_SERVER_INCREMENT
    window.scrollTo(0, 0)
  }

  watch(filterCountry, () => {
    const cities = citiesForCountry.value
    filterCity.value = cities.length === 1 ? cities[0] : ''
    resetVisibleState()
  })
  
  watch(filterCity, resetVisibleState)

  const loadMoreServers = () => {
    if (isLoading.value) return
    if (visibleServers.value.length < processedServers.value.length) {
      visibleCount.value += VISIBLE_SERVER_INCREMENT
    }
  }

  const toggleSort = (newSortBy) => {
    resetVisibleState()
    if (sortBy.value === newSortBy) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortBy.value = newSortBy
      sortOrder.value = 'asc'
    }
  }

  const loadServers = async () => {
    isLoading.value = true
    try {
      const { h: headers, l: locations } = await apiService.getServers()
      const headerMap = Object.fromEntries(headers.map((header, index) => [header, index]))
      
      const requiredHeaders = ['name', 'load', 'station']
      if (!requiredHeaders.every(h => h in headerMap)) {
        throw new Error('API response is missing required server data fields.')
      }

      allServers.value = Object.entries(locations).flatMap(([country, cities]) =>
        Object.entries(cities).flatMap(([city, serverTuples]) =>
          serverTuples.map(tuple => {
            const serverData = {
              name: tuple[headerMap.name],
              load: tuple[headerMap.load],
              station: tuple[headerMap.station],
              ip: tuple[headerMap.station],
            }
            return createServerViewModel(serverData, country, city)
          })
        )
      )
    } finally {
      isLoading.value = false
    }
  }

  return {
    visibleServers,
    isLoading,
    sortBy,
    sortOrder,
    filterCountry,
    filterCity,
    countries,
    citiesForCountry,
    filteredCount,
    loadMoreServers,
    toggleSort,
    loadServers,
  }
}