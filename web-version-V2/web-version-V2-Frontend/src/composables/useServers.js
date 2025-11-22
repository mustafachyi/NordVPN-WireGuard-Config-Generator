import { shallowRef, computed, watch, markRaw } from 'vue'
import { formatName } from '@/utils/utils'

const INC = 24

export function useServers() {
  const all = shallowRef([])
  const loading = shallowRef(false)
  const sortKey = shallowRef('name')
  const sortOrd = shallowRef('asc')
  const fCountry = shallowRef('')
  const fCity = shallowRef('')
  const limit = shallowRef(INC)
  
  const countries = shallowRef([])
  const cityMap = shallowRef({})

  const filtered = computed(() => {
    const c = fCountry.value
    const t = fCity.value
    let list = all.value
    
    if (c) list = list.filter(s => s.country === c)
    if (t) list = list.filter(s => s.city === t)
    
    const k = sortKey.value
    const m = sortOrd.value === 'asc' ? 1 : -1
    
    return [...list].sort((a, b) => {
      if (k === 'load') {
        const d = a.load - b.load
        if (d !== 0) return d * m
      }
      return (a.dName > b.dName ? 1 : -1) * m
    })
  })

  const visible = computed(() => filtered.value.slice(0, limit.value))
  const total = computed(() => filtered.value.length)
  const currentCities = computed(() => cityMap.value[fCountry.value] || [])

  const reset = () => {
    limit.value = INC
    window.scrollTo(0, 0)
  }

  watch(fCountry, () => {
    const l = cityMap.value[fCountry.value] || []
    fCity.value = l.length === 1 ? l[0].id : ''
    reset()
  })
  
  watch([fCity, sortKey, sortOrd], reset)

  const init = async () => {
    loading.value = true
    try {
      const el = document.getElementById('server-data')
      if (!el?.textContent) return
      
      const { h, l } = JSON.parse(el.textContent)
      const idx = Object.fromEntries(h.map((k, i) => [k, i]))
      if (!['name', 'load', 'station'].every(k => k in idx)) throw new Error('Invalid data')

      const list = []
      const cSet = new Set()
      const cMap = {}
      const fmtCache = new Map()
      
      const getFmt = s => {
        if (fmtCache.has(s)) return fmtCache.get(s)
        const v = formatName(s)
        fmtCache.set(s, v)
        return v
      }

      for (const [cn, cities] of Object.entries(l)) {
        cSet.add(cn)
        const cityList = []
        const dCountry = getFmt(cn)
        
        for (const [ci, servers] of Object.entries(cities)) {
          cityList.push(ci)
          const dCity = getFmt(ci)
          
          for (const t of servers) {
            list.push(markRaw({
              name: t[idx.name],
              load: t[idx.load],
              station: t[idx.station],
              ip: t[idx.station],
              country: cn,
              city: ci,
              dName: formatName(t[idx.name]),
              dCountry,
              dCity
            }))
          }
        }
        cMap[cn] = cityList.sort().map(c => ({ id: c, name: getFmt(c) }))
      }

      all.value = list
      countries.value = [...cSet].sort().map(c => ({ id: c, name: getFmt(c) }))
      cityMap.value = cMap
    } catch (e) {
      console.error(e)
    } finally {
      loading.value = false
    }
  }

  return {
    visible,
    loading,
    sortKey,
    sortOrd,
    fCountry,
    fCity,
    countries,
    cities: currentCities,
    total,
    loadMore: () => { if (!loading.value && limit.value < total.value) limit.value += INC },
    toggleSort: k => {
      if (sortKey.value === k) sortOrd.value = sortOrd.value === 'asc' ? 'desc' : 'asc'
      else { sortKey.value = k; sortOrd.value = 'asc' }
    },
    init
  }
}