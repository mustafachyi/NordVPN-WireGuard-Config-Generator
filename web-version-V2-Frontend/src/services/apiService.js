/**
 * API service for communicating with the backend
 */

// Config
const CONFIG = {
    development: { baseURL: 'http://localhost:3000/api', timeout: 5000 },
    production: { baseURL: '/api', timeout: 10000 }
}

// Set this to 'development' or 'production'
const MODE = 'development'
const settings = { ...CONFIG[MODE] }

// Content types
const CONTENT_TYPES = {
    JSON: 'application/json',
    TEXT: 'text/plain',
    WIREGUARD: 'application/x-wireguard-config',
    IMAGE: 'image/'
}

// Response handlers
const responseHandlers = {
    [CONTENT_TYPES.JSON]: r => r.json(),
    [CONTENT_TYPES.TEXT]: r => r.text(),
    [CONTENT_TYPES.WIREGUARD]: r => r.blob(),
    [CONTENT_TYPES.IMAGE]: r => r.blob()
}

/**
 * Fetches data from the API with timeout handling
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function fetchAPI(endpoint, options = {}) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), settings.timeout)

    try {
        const response = await fetch(`${settings.baseURL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': CONTENT_TYPES.JSON,
                ...options.headers
            },
            signal: controller.signal
        })
        
        if (!response.ok) {
            const error = new Error(`HTTP error! status: ${response.status}`)
            error.status = response.status
            throw error
        }
        
        const contentType = response.headers.get('content-type')
        const handler = Object.entries(responseHandlers).find(
            ([type]) => contentType?.includes(type)
        )?.[1]

        return handler ? handler(response) : response.text()
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${settings.timeout}ms`)
        }
        throw error
    } finally {
        clearTimeout(timeoutId)
    }
}

export const apiService = {
    // Mode management
    setMode: mode => {
        if (!CONFIG[mode]) throw new Error(`Invalid mode: ${mode}. Use 'development' or 'production'`)
        Object.assign(settings, CONFIG[mode])
    },
    getMode: () => MODE,

    // API endpoints
    getServers: () => fetchAPI('/servers'),
    
    generateKey: token => fetchAPI('/key', {
        method: 'POST',
        body: JSON.stringify({ token })
    }),

    generateConfig: config => fetchAPI('/config', {
        method: 'POST',
        body: JSON.stringify(config)
    }).then(response => typeof response === 'object' ? JSON.stringify(response) : response),

    downloadConfig: config => fetchAPI('/config/download', {
        method: 'POST',
        body: JSON.stringify(config),
        headers: { 'Accept': CONTENT_TYPES.WIREGUARD }
    }),

    generateQR: config => fetchAPI('/config/qr', {
        method: 'POST',
        body: JSON.stringify(config),
        headers: { 'Accept': CONTENT_TYPES.IMAGE }
    })
}
