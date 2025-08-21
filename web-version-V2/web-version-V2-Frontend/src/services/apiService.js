const apiSettings = {
    baseURL: '/api',
    timeout: 10000
};

const CONTENT_TYPES = {
    JSON: 'application/json',
    TEXT: 'text/plain',
    WIREGUARD: 'application/x-wireguard-config',
    IMAGE: 'image/'
};

const responseHandlers = {
    [CONTENT_TYPES.JSON]: r => r.json(),
    [CONTENT_TYPES.TEXT]: r => r.text(),
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
        
        if (contentType.includes(CONTENT_TYPES.WIREGUARD) || contentType.startsWith(CONTENT_TYPES.IMAGE)) {
            return response;
        }

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

    downloadConfig: async (config) => {
        const response = await request('/config/download', {
            method: 'POST',
            body: JSON.stringify(config),
            headers: { 'Accept': CONTENT_TYPES.WIREGUARD }
        });

        const disposition = response.headers.get('content-disposition');
        let filename = null;
        if (disposition && disposition.includes('attachment')) {
            const match = /filename="([^"]+)"/.exec(disposition);
            if (match && match[1]) {
                filename = match[1];
            }
        }
        const blob = await response.blob();
        return { blob, filename };
    },

    generateQR: async (config) => {
        const response = await request('/config/qr', {
            method: 'POST',
            body: JSON.stringify(config),
            headers: { 'Accept': CONTENT_TYPES.IMAGE }
        });
        return response.blob();
    }
};