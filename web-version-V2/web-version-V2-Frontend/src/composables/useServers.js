import { ref, computed, toRefs, watch } from 'vue'
import { apiService } from '../services/apiService'
import { formatDisplayName, debounce } from '../utils/utils'

const VISIBLE_SERVER_INCREMENT = 24
const FILTER_DEBOUNCE_MS = 250

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
    processedServers: [],
    isLoading: false,
    sortBy: 'name',
    sortOrder: 'asc',
    filterCountry: '',
    filterCity: ''
  })

  const { allServers, visibleServers, processedServers, isLoading, sortBy, sortOrder, filterCountry, filterCity } = toRefs(state.value)

  const getUniqueSortedValues = (key) => computed(() =>
    [...new Set(allServers.value.map(s => s[key]))].sort()
  )

  const countries = getUniqueSortedValues('country')

  const citiesForCountry = computed(() =>
    filterCountry.value
      ? [...new Set(allServers.value.filter(s => s.country === filterCountry.value).map(s => s.city))].sort()
      : []
  )

  const filteredCount = computed(() => processedServers.value.length)

  const updateVisibleServers = () => {
    visibleServers.value = processedServers.value.slice(0, VISIBLE_SERVER_INCREMENT)
  }

  const processServers = () => {
    const servers = allServers.value.filter(s =>
      (!filterCountry.value || s.country === filterCountry.value) &&
      (!filterCity.value || s.city === filterCity.value)
    )
    const compareFunction = SORT_FUNCTIONS[sortBy.value] || SORT_FUNCTIONS.name
    const sortMultiplier = sortOrder.value === 'asc' ? 1 : -1
    
    processedServers.value = servers.sort((a, b) => compareFunction(a, b) * sortMultiplier)
    updateVisibleServers()
  }

  const debouncedProcessServers = debounce(processServers, FILTER_DEBOUNCE_MS)
  
  watch([filterCountry, filterCity, sortBy], debouncedProcessServers)

  const loadMoreServers = () => {
    if (isLoading.value) return
    const currentLength = visibleServers.value.length
    const nextChunk = processedServers.value.slice(currentLength, currentLength + VISIBLE_SERVER_INCREMENT)
    if (nextChunk.length > 0) {
      visibleServers.value.push(...nextChunk)
    }
  }

  const toggleSort = (newSortBy) => {
    if (sortBy.value === newSortBy) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
      processedServers.value.reverse()
      updateVisibleServers()
    } else {
      sortBy.value = newSortBy
      sortOrder.value = 'asc'
    }
  }

  const loadServers = async () => {
    isLoading.value = true
    try {
      const { h: headers, l: locations } = await apiService.getServers();
      const headerMap = Object.fromEntries(headers.map((header, index) => [header, index]));
      
      const nameIndex = headerMap.name;
      const loadIndex = headerMap.load;
      const stationIndex = headerMap.station;

      allServers.value = Object.entries(locations).flatMap(([country, cities]) =>
        Object.entries(cities).flatMap(([city, serverTuples]) =>
          serverTuples.map(tuple => {
            const server = {
              name: tuple[nameIndex],
              load: tuple[loadIndex],
              station: tuple[stationIndex],
              ip: tuple[stationIndex],
            };
            return createServerViewModel(server, country, city);
          })
        )
      );
      processServers();
    } catch (err) {
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

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
    loadServers
  }
}