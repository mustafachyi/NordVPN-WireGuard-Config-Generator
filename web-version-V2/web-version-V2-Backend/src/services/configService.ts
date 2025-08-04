import type { ProcessedServer } from './serverService';

export interface ConfigRequest {
    [key: string]: unknown;
}

export interface ValidatedConfig {
    country: string;
    city: string;
    name: string;
    privateKey?: string;
    dns?: string;
    useStation: boolean;
    keepalive?: number;
}

type ValidationResult =
    | { success: true; data: ValidatedConfig }
    | { success: false; error: string };

const PATTERNS = {
    privateKey: /^[A-Za-z0-9+/]{43}=$/,
    ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
};

const VALIDATORS: {
    [key: string]: (value: any) => string | null;
} = {
    country: (v) => (typeof v === 'string' && v ? null : 'Field "country" is required and must be a string.'),
    city: (v) => (typeof v === 'string' && v ? null : 'Field "city" is required and must be a string.'),
    name: (v) => (typeof v === 'string' && v ? null : 'Field "name" is required and must be a string.'),
    privateKey: (v) => !v || (typeof v === 'string' && PATTERNS.privateKey.test(v)) ? null : 'Invalid privateKey format.',
    dns: (v) => !v || (typeof v === 'string' && v.split(',').every(ip => PATTERNS.ipv4.test(ip.trim()))) ? null : 'Invalid DNS format.',
    endpoint: (v) => !v || ['hostname', 'station'].includes(v) ? null : 'Endpoint must be "hostname" or "station".',
    keepalive: (v) => !v || (typeof v === 'number' && v >= 15 && v <= 120) ? null : 'Keepalive must be a number between 15 and 120.',
};

export function validateConfigRequest(request: ConfigRequest): ValidationResult {
    for (const field in VALIDATORS) {
        const error = VALIDATORS[field](request[field]);
        if (error) {
            return { success: false, error };
        }
    }
    
    return {
        success: true,
        data: {
            country: request.country as string,
            city: request.city as string,
            name: request.name as string,
            privateKey: request.privateKey as string | undefined,
            dns: request.dns as string | undefined,
            useStation: request.endpoint === 'station',
            keepalive: request.keepalive as number | undefined,
        },
    };
}

export function generateConfiguration(
    server: ProcessedServer,
    publicKey: string,
    options: Omit<ValidatedConfig, 'country' | 'city' | 'name'>
): string {
    const {
        privateKey = '',
        dns = '103.86.96.100',
        useStation = false,
        keepalive = 25,
    } = options;

    const endpoint = useStation ? server.station : server.hostname;
    const dnsServers = dns.split(',').map(ip => ip.trim()).join(', ');

    return `[Interface]
PrivateKey=${privateKey}
Address=10.5.0.2/16
DNS=${dnsServers}

[Peer]
PublicKey=${publicKey}
AllowedIPs=0.0.0.0/0,::/0
Endpoint=${endpoint}:51820
PersistentKeepalive=${keepalive}`;
}