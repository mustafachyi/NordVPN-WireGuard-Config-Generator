import { createHash } from 'crypto';

/**
 * Validates WireGuard private key format
 */
export function isValidPrivateKey(key: string): boolean {
    return /^[A-Za-z0-9+/]{43}=$/.test(key);
}

/**
 * Normalizes server names for file paths
 */
export function normalizeServerName(name: string): string {
    return name.replace(/[^a-z0-9]/g,'_');
}

/**
 * Validates data format
 */
export function validateData(data: string): boolean {
    return data.length > 16 && data.slice(-1) === '=';
}

/**
 * Generates a secure key based on timestamp
 */
export function generateKey(timestamp: number): string {
    const hash = createHash('sha256');
    const timeValue = (timestamp * 1597 + 51820).toString();
    return hash.update(timeValue).digest('base64');
}

/**
 * Creates normalized path from parts
 */
export function buildPath(parts: string[]): string {
    return parts.map(x => x.toLowerCase()).join('_');
} 