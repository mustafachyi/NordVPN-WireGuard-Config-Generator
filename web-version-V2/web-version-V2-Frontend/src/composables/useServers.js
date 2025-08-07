import { ref, computed, watch, markRaw } from 'vue'
import { formatDisplayName } from '@/utils/utils'

const VISIBLE_SERVER_INCREMENT = 24

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
  const sortedByName = ref([])
  const sortedByLoad = ref([])
  
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

  const filteredAndSortedServers = computed(() => {
    const baseList = sortBy.value === 'load' ? sortedByLoad.value : sortedByName.value

    const filtered = baseList.filter(s =>
      (!filterCountry.value || s.country === filterCountry.value) &&
      (!filterCity.value || s.city === filterCity.value)
    )

    return sortOrder.value === 'asc' ? filtered : filtered.slice().reverse()
  })

  const visibleServers = computed(() => filteredAndSortedServers.value.slice(0, visibleCount.value))
  
  const filteredCount = computed(() => filteredAndSortedServers.value.length)
  
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
  watch([sortBy, sortOrder], resetVisibleState)

  const loadMoreServers = () => {
    if (isLoading.value) return
    if (visibleServers.value.length < filteredAndSortedServers.value.length) {
      visibleCount.value += VISIBLE_SERVER_INCREMENT
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
    isLoading.value = true;
    try {
        const dataElement = document.getElementById('server-data');
        if (!dataElement?.textContent) {
            throw new Error('Inlined server data script not found in HTML.');
        }
        const { h: headers, l: locations } = JSON.parse(dataElement.textContent);
        
        const headerMap = Object.fromEntries(headers.map((header, index) => [header, index]));
        const requiredHeaders = ['name', 'load', 'station'];
        if (!requiredHeaders.every(h => h in headerMap)) {
            throw new Error('Inlined data is missing required server fields.');
        }

        const flattenedServers = Object.entries(locations).flatMap(([country, cities]) =>
            Object.entries(cities).flatMap(([city, serverTuples]) =>
                serverTuples.map(tuple => {
                    const serverData = {
                        name: tuple[headerMap.name],
                        load: tuple[headerMap.load],
                        station: tuple[headerMap.station],
                        ip: tuple[headerMap.station],
                    };
                    return markRaw(createServerViewModel(serverData, country, city));
                })
            )
        );
        
        allServers.value = flattenedServers
        sortedByName.value = [...flattenedServers].sort((a, b) => a.displayName.localeCompare(b.displayName))
        sortedByLoad.value = [...flattenedServers].sort((a, b) => a.load - b.load)

    } catch (error) {
        console.error("Failed to load and parse inlined server data:", error);
        throw new Error('Unable to load server list.');
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
    loadServers,
  }
}