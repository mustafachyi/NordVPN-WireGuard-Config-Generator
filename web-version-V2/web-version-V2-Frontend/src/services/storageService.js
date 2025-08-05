const ALLOWED_STORAGE_KEYS = [
  'wg_gen_settings',
  'showServerIp',
];

export const storageService = {
  get(key) {
    const item = localStorage.getItem(key);
    if (!item) {
      return null;
    }
    try {
      return JSON.parse(item);
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  },

  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  cleanup() {
    const currentKeys = Object.keys(localStorage);
    for (const key of currentKeys) {
      if (!ALLOWED_STORAGE_KEYS.includes(key)) {
        localStorage.removeItem(key);
      }
    }
  },
};