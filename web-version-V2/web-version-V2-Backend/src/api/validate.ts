import type { ConfigRequest, ValidatedConfig } from '../types';

const RX_TOKEN = /^[a-f0-9]{64}$/i;
const RX_KEY = /^[A-Za-z0-9+/]{43}=$/;
const RX_IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

export const validateToken = (t: unknown) => typeof t === 'string' && RX_TOKEN.test(t);

export const validateConfig = (b: ConfigRequest): { ok: true; data: ValidatedConfig } | { ok: false; msg: string } => {
    const errors: string[] = [];
    
    if (!b.country || typeof b.country !== 'string') errors.push('Missing country');
    if (!b.city || typeof b.city !== 'string') errors.push('Missing city');
    if (!b.name || typeof b.name !== 'string') errors.push('Missing name');
    
    if (b.privateKey && !RX_KEY.test(b.privateKey)) errors.push('Invalid Private Key');
    
    let cleanDns = '103.86.96.100';
    if (b.dns) {
        const ips = b.dns.split(',').map(x => x.trim());
        if (!ips.every(ip => RX_IPV4.test(ip))) errors.push('Invalid DNS IP');
        else cleanDns = ips.join(', ');
    }

    if (b.endpoint && b.endpoint !== 'hostname' && b.endpoint !== 'station') errors.push('Invalid endpoint type');
    
    const ka = b.keepalive;
    if (ka !== undefined && (typeof ka !== 'number' || ka < 15 || ka > 120)) errors.push('Invalid keepalive');

    if (errors.length) return { ok: false, msg: errors.join(', ') };

    return {
        ok: true,
        data: {
            name: b.name!,
            privateKey: b.privateKey || '',
            dns: cleanDns,
            useStation: b.endpoint === 'station',
            keepalive: ka ?? 25
        }
    };
};