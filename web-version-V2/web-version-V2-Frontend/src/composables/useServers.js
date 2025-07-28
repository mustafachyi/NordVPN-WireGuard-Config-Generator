import { ref, computed, toRefs } from 'vue'
import { apiService } from '../services/apiService'
import { formatDisplayName } from '../utils/utils'

const VISIBLE_SERVER_INCREMENT = 100

const SORT_FUNCTIONS = {
  load: (a, b) => a.load - b.load,
  name: (a, b) => a.displayName.localeCompare(b.displayName)
}

const createServerViewModel = (server, country, city) => ({
  ...server,
  country,
  city,
  displayName: formatDisplayName(server.name),
  displayCountry: formatDisplayName(country),
  displayCity: formatDisplayName(city)
})

export function useServers() {
  const state = ref({
    allServers: [],
    visibleServers: [],
    isLoading: false,
    sortBy: 'name',
    sortOrder: 'asc',
    filterCountry: '',
    filterCity: ''
  })

  const { allServers, visibleServers, isLoading, sortBy, sortOrder, filterCountry, filterCity } = toRefs(state.value)

  const getUniqueSortedValues = (key) => computed(() =>
    [...new Set(allServers.value.map(s => s[key]))].sort()
  )

  const countries = getUniqueSortedValues('country')

  const citiesForCountry = computed(() =>
    filterCountry.value
      ? [...new Set(allServers.value.filter(s => s.country === filterCountry.value).map(s => s.city))].sort()
      : []
  )

  const filteredAndSortedServers = computed(() => {
    const servers = allServers.value.filter(s =>
      (!filterCountry.value || s.country === filterCountry.value) &&
      (!filterCity.value || s.city === filterCity.value)
    )
    const compareFunction = SORT_FUNCTIONS[sortBy.value] || SORT_FUNCTIONS.name
    const sortMultiplier = sortOrder.value === 'asc' ? 1 : -1
    return servers.sort((a, b) => compareFunction(a, b) * sortMultiplier)
  })

  const filteredCount = computed(() => filteredAndSortedServers.value.length)

  const updateVisibleServers = () => {
    visibleServers.value = filteredAndSortedServers.value.slice(0, VISIBLE_SERVER_INCREMENT)
  }

  const loadMoreServers = () => {
    if (isLoading.value) return
    const currentLength = visibleServers.value.length
    const nextChunk = filteredAndSortedServers.value.slice(currentLength, currentLength + VISIBLE_SERVER_INCREMENT)
    if (nextChunk.length > 0) {
      visibleServers.value.push(...nextChunk)
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
    isLoading.value = true
    try {
      const serverData = await apiService.getServers()
      allServers.value = Object.entries(serverData).flatMap(([country, cities]) =>
        Object.entries(cities).flatMap(([city, servers]) =>
          servers.map(server => createServerViewModel(server, country, city))
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
    visibleServers,
    isLoading,
    sortBy,
    sortOrder,
    filterCountry,
    filterCity,
    countries,
    citiesForCountry,
    filteredCount,
    updateVisibleServers,
    loadMoreServers,
    toggleSort,
    loadServers
  }
}