import type { ProcessedServer } from './serverService';

export interface ConfigRequest {
    [key:string]: unknown;
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

export function validateConfigRequest(request: ConfigRequest): ValidationResult {
    const { country, city, name, privateKey, dns, endpoint, keepalive } = request;
    const errors: string[] = [];

    if (typeof country !== 'string' || !country) {
        errors.push('Field "country" is required and must be a string.');
    }
    if (typeof city !== 'string' || !city) {
        errors.push('Field "city" is required and must be a string.');
    }
    if (typeof name !== 'string' || !name) {
        errors.push('Field "name" is required and must be a string.');
    }

    if (privateKey && (typeof privateKey !== 'string' || !PATTERNS.privateKey.test(privateKey))) {
        errors.push('Invalid privateKey format.');
    }

    let sanitizedDns: string | undefined;
    if (dns !== undefined && dns !== null && dns !== '') {
        if (typeof dns === 'string') {
            const ips = dns.split(',').map(ip => ip.trim());
            if (ips.every(ip => ip && PATTERNS.ipv4.test(ip))) {
                sanitizedDns = ips.join(', ');
            } else {
                errors.push('Invalid DNS format: All IPs must be valid IPv4 addresses.');
            }
        } else {
            errors.push('Invalid DNS format: Field must be a string.');
        }
    }

    if (endpoint !== undefined && !['hostname', 'station'].includes(endpoint as string)) {
        errors.push('Endpoint must be "hostname" or "station".');
    }

    if (keepalive !== undefined && (typeof keepalive !== 'number' || keepalive < 15 || keepalive > 120)) {
        errors.push('Keepalive must be a number between 15 and 120.');
    }

    if (errors.length > 0) {
        return { success: false, error: errors.join(' ') };
    }

    return {
        success: true,
        data: {
            country: country as string,
            city: city as string,
            name: name as string,
            privateKey: privateKey as string | undefined,
            dns: sanitizedDns,
            useStation: endpoint === 'station',
            keepalive: keepalive as number | undefined,
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

    return `[Interface]
PrivateKey=${privateKey}
Address=10.5.0.2/16
DNS=${dns}

[Peer]
PublicKey=${publicKey}
AllowedIPs=0.0.0.0/0,::/0
Endpoint=${endpoint}:51820
PersistentKeepalive=${keepalive}`;
}