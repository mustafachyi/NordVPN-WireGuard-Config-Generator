// View Constants
export const VIEW_TYPE_NORDVPN = 'nordvpn-config-view';

// Cache Settings
export const CACHE_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes

// API Related Constants
export const API_ENDPOINTS = {
    KEY: '/api/key',
    SERVERS: '/api/servers',
    CONFIG: '/api/config',
    QR_CODE: '/api/config/qr',
    DOWNLOAD: '/api/config/download'
} as const;

// HTTP Status Codes
export const HTTP_STATUS = {
    NOT_MODIFIED: 304,
    UNAUTHORIZED: 401,
    SERVICE_UNAVAILABLE: 503
} as const;

// Validation Constants
export const TOKEN_REGEX = /^[a-fA-F0-9]{64}$/;

// Default Plugin Settings
export const DEFAULT_SETTINGS = {
    dns: '103.86.96.100',
    endpoint_type: 'hostname' as const,
    keepalive: 25,
    outputFolder: 'nordvpn-configs',
    apiUrl: 'https://nord-configs.onrender.com'
} as const;

// Icon SVG - Modified for Obsidian's ribbon
export const NORDVPN_ICON = `<svg viewBox="0 0 50 50" width="20" height="20" fill="currentColor" style="stroke: currentColor; stroke-width: 0.5;"><path d="M25 5C11.878 5 3 14.878 3 28c0 4.135.955 8.027 3.152 11.531a1 1 0 0 0 1.694.004l9.103-14.394.012.02 1.152 1.735 3.407 5.133-1.74-5.129-.003-.002.028-.04L25 18.188l4.57 7.993 2.4 4.199-.83-3.942-.017-.027a1 1 0 0 0 .154-.183l.694-1.069 9.44 15.34a1 1 0 0 0 1.671.047C45.648 36.872 47 32.552 47 28c0-12.122-9.878-22-22-22m0 2c11.038 0 20 8.962 20 20 0 3.587-1.081 6.908-2.83 9.92l-9.326-15.156a1 1 0 0 0-1.692-.02l-.66 1.02-4.603-8.051a1 1 0 0 0-1.725-.018l-5.26 8.776-1.142-1.723a1 1 0 0 0-1.68.02L7.156 36.88C5.783 34.137 5 31.22 5 28 5 16.962 13.962 8 25 8"/></svg>`; 