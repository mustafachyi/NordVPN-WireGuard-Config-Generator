const KEYS = ['wg_gen_settings', 'showIp']

export const storage = {
  get: k => {
    try {
      const i = localStorage.getItem(k)
      return i ? JSON.parse(i) : null
    } catch { return null }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  clean: () => Object.keys(localStorage).forEach(k => { if (!KEYS.includes(k)) localStorage.removeItem(k) })
}