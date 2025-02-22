import axios, { AxiosError } from 'axios';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { API_ENDPOINTS, HTTP_STATUS } from './constants';
import { normalizeServerName, validateData, generateKey, buildPath } from './utils';

// Request Types
export interface ConfigRequest {
    country: string;
    city: string;
    name: string;
    privateKey?: string;
    dns: string;
    endpoint: 'hostname' | 'station';
    keepalive: number;
}

// API Response Types
interface ApiErrorResponse {
    error?: string;
}

// Custom Error Types
class ApiError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Configuration for secure data handling
 */
const secureConfig = {
    version: '2.1.0',
    encoding: 'base64' as BufferEncoding,
    cipher: 'aes-256-gcm' as const,
    timeout: 300000,
    tagLength: 16,
    port: 51820,
    maxLength: 85
};

/**
 * Generates random initialization vector
 */
function generateIV(): Buffer {
    return randomBytes(16);
}

/**
 * Formats buffer to string
 */
function formatBuffer(data: Buffer): string {
    return data.toString(secureConfig.encoding);
}

/**
 * Parses string to buffer
 */
function parseBuffer(data: string): Buffer {
    return Buffer.from(data, secureConfig.encoding);
}

/**
 * Encrypts data with provided key
 */
function encryptData(input: string, key: string): { iv: string, data: string } {
    const iv = generateIV();
    const cipher = createCipheriv(secureConfig.cipher, parseBuffer(key), iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(input,'utf8')), cipher.final()]);
    const tag = (cipher as any).getAuthTag();
    return { iv: formatBuffer(iv), data: formatBuffer(Buffer.concat([encrypted, tag])) };
}

/**
 * Decrypts data with provided key
 */
function decryptData(iv: string, data: string, key: string): string {
    const ivBuffer = parseBuffer(iv);
    const dataBuffer = parseBuffer(data);
    const tag = dataBuffer.slice(-16);
    const encrypted = dataBuffer.slice(0, -16);
    const decipher = createDecipheriv(secureConfig.cipher, parseBuffer(key), ivBuffer);
    (decipher as any).setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
}

export class ApiService {
    constructor(private apiUrl: string) {}

    async validateToken(token: string): Promise<string> {
        try {
            const response = await axios.post(`${this.apiUrl}${API_ENDPOINTS.KEY}`, { token });
            return response.data.key;
        } catch (error) {
            return this.handleApiError(error as AxiosError<ApiErrorResponse>, 'Failed to validate token');
        }
    }

    async getServers(etag?: string): Promise<{ data: any; etag?: string }> {
        try {
            const headers: Record<string, string> = {};
            if (etag) {
                headers['If-None-Match'] = etag;
            }

            const response = await axios.get(`${this.apiUrl}${API_ENDPOINTS.SERVERS}`, { headers });
            return {
                data: response.data,
                etag: response.headers['etag']
            };
        } catch (error) {
            const axiosError = error as AxiosError<ApiErrorResponse>;
            if (axiosError.response?.status === HTTP_STATUS.NOT_MODIFIED) {
                return { data: null };
            }
            return this.handleApiError(axiosError, 'Failed to fetch server list');
        }
    }

    async generateConfig(config: ConfigRequest): Promise<string> {
        try {
            const response = await axios.post(
                `${this.apiUrl}${API_ENDPOINTS.CONFIG}`,
                config,
                { headers: { 'Accept': 'text/plain' } }
            );
            return response.data;
        } catch (error) {
            return this.handleApiError(error as AxiosError<ApiErrorResponse>, 'Failed to generate configuration');
        }
    }

    async generateQRCode(config: ConfigRequest): Promise<Blob> {
        try {
            const response = await axios.post(
                `${this.apiUrl}${API_ENDPOINTS.QR_CODE}`,
                config,
                { responseType: 'arraybuffer' }
            );
            return new Blob([response.data], { type: 'image/webp' });
        } catch (error) {
            return this.handleApiError(error as AxiosError<ApiErrorResponse>, 'Failed to generate QR code');
        }
    }

    async downloadConfig(config: ConfigRequest): Promise<Blob> {
        try {
            const response = await axios.post(
                `${this.apiUrl}${API_ENDPOINTS.DOWNLOAD}`,
                config,
                { responseType: 'blob' }
            );
            return new Blob([response.data], { type: 'application/x-wireguard-config' });
        } catch (error) {
            return this.handleApiError(error as AxiosError<ApiErrorResponse>, 'Failed to download configuration');
        }
    }

    /**
     * Encrypts data with provided key
     */
    encryptData(input: string, key: string): { iv: string, data: string } {
        return encryptData(input, key);
    }

    /**
     * Decrypts data with provided key
     */
    decryptData(iv: string, data: string, key: string): string {
        return decryptData(iv, data, key);
    }

    private handleApiError(error: AxiosError<ApiErrorResponse>, defaultMessage: string): never {
        const status = error.response?.status;
        const message = error.response?.data?.error || error.message;

        if (status === HTTP_STATUS.UNAUTHORIZED) {
            throw new ApiError('Invalid or unauthorized token.', status);
        } else if (status === HTTP_STATUS.SERVICE_UNAVAILABLE) {
            throw new ApiError('NordVPN API is currently unavailable.', status);
        }

        throw new ApiError(`${defaultMessage}: ${message}`, status);
    }
} 