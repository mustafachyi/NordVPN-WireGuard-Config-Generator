import type { ProcessedServer } from './serverService';

export interface ConfigRequest {
    country?: unknown;
    city?: unknown;
    name?: unknown;
    privateKey?: unknown;
    dns?: unknown;
    endpoint?: unknown;
    keepalive?: unknown;
}

export interface ValidatedConfigRequest {
    country: string;
    city: string;
    name: string;
    privateKey?: string;
    dns?: string;
    useStation: boolean;
    keepalive?: number;
}

type ValidationResult =
    | { success: true; data: ValidatedConfigRequest }
    | { success: false; error: string };

const PATTERNS = {
    privateKey: /^[A-Za-z0-9+/]{43}=$/,
    ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
};

const validateStringField = (value: unknown, fieldName: string): string | null => {
    if (typeof value !== 'string' || !value) {
        return `Field "${fieldName}" must be a non-empty string.`;
    }
    return null;
};

export function validateConfigRequest(req: ConfigRequest): ValidationResult {
    const { country, city, name, privateKey, dns, endpoint, keepalive } = req;

    const countryError = validateStringField(country, 'country');
    if (countryError) return { success: false, error: countryError };
    const cityError = validateStringField(city, 'city');
    if (cityError) return { success: false, error: cityError };
    const nameError = validateStringField(name, 'name');
    if (nameError) return { success: false, error: nameError };

    if (privateKey !== undefined) {
        if (typeof privateKey !== 'string') {
            return { success: false, error: 'Field "privateKey" must be a string.' };
        }
        if (privateKey.length > 0 && !PATTERNS.privateKey.test(privateKey)) {
             return { success: false, error: 'Invalid privateKey format: must be a 44-character Base64 string.' };
        }
    }
    if (dns !== undefined && (typeof dns !== 'string' || !dns.split(',').every((ip) => PATTERNS.ipv4.test(ip.trim())))) {
        return { success: false, error: 'Invalid dns format: must be a comma-separated list of valid IPv4 addresses.' };
    }
    if (endpoint !== undefined && endpoint !== 'hostname' && endpoint !== 'station') {
        return { success: false, error: 'Invalid endpoint: must be either "hostname" or "station".' };
    }
    if (keepalive !== undefined && (typeof keepalive !== 'number' || keepalive < 15 || keepalive > 120)) {
        return { success: false, error: 'Invalid keepalive: must be a number between 15 and 120.' };
    }

    return {
        success: true,
        data: {
            country: country as string,
            city: city as string,
            name: name as string,
            privateKey: privateKey as string | undefined,
            dns: dns as string | undefined,
            useStation: endpoint === 'station',
            keepalive: keepalive as number | undefined,
        },
    };
}

export function generateConfiguration(
    server: ProcessedServer,
    publicKey: string,
    options: Omit<ValidatedConfigRequest, 'country' | 'city' | 'name'>
): string {
    const {
        privateKey,
        dns = '103.86.96.100',
        useStation = false,
        keepalive = 25,
    } = options;
    
    const finalPrivateKey = privateKey || '';
    const endpointAddress = useStation ? server.station : server.hostname;
    const dnsServers = dns.split(',').map((ip) => ip.trim()).join(', ');

    const interfaceSection = `[Interface]
PrivateKey=${finalPrivateKey}
Address=10.5.0.2/16
DNS=${dnsServers}`;

    const peerSection = `[Peer]
PublicKey=${publicKey}
AllowedIPs=0.0.0.0/0,::/0
Endpoint=${endpointAddress}:51820
PersistentKeepalive=${keepalive}`;

    return `${interfaceSection}\n\n${peerSection}`;
}