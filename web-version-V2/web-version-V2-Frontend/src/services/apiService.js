const API_CONFIG = {
    development: { baseURL: 'http://localhost:3000/api', timeout: 5000 },
    production: { baseURL: '/api', timeout: 10000 }
};

const apiSettings = API_CONFIG[import.meta.env.PROD ? 'production' : 'development'];

const CONTENT_TYPES = {
    JSON: 'application/json',
    TEXT: 'text/plain',
    WIREGUARD: 'application/x-wireguard-config',
    IMAGE: 'image/'
};

const responseHandlers = {
    [CONTENT_TYPES.JSON]: r => r.json(),
    [CONTENT_TYPES.TEXT]: r => r.text(),
    [CONTENT_TYPES.WIREGUARD]: r => r.blob(),
    [CONTENT_TYPES.IMAGE]: r => r.blob()
};

async function request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), apiSettings.timeout);

    try {
        const response = await fetch(`${apiSettings.baseURL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': CONTENT_TYPES.JSON,
                ...options.headers
            },
            signal: controller.signal
        });

        if (!response.ok) {
            const error = new Error(`HTTP error status: ${response.status}`);
            error.status = response.status;
            try {
                error.data = await response.json();
            } catch {
                error.data = await response.text();
            }
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        const handler = Object.entries(responseHandlers).find(
            ([type]) => contentType.includes(type)
        )?.[1] || (r => r.text());

        return handler(response);
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${apiSettings.timeout}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export const apiService = {
    generateKey: token => request('/key', {
        method: 'POST',
        body: JSON.stringify({ token })
    }),

    generateConfig: config => request('/config', {
        method: 'POST',
        body: JSON.stringify(config)
    }),

    downloadConfig: config => request('/config/download', {
        method: 'POST',
        body: JSON.stringify(config),
        headers: { 'Accept': CONTENT_TYPES.WIREGUARD }
    }),

    generateQR: config => request('/config/qr', {
        method: 'POST',
        body: JSON.stringify(config),
        headers: { 'Accept': CONTENT_TYPES.IMAGE }
    })
};