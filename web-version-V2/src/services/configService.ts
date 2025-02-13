import type { ProcessedServer } from "./serverService";

export interface ConfigOptions {
  privateKey?: string;
  dns?: string;
  useStation?: boolean;
  keepalive?: number;
}

export const CONFIG_VALIDATION = {
  privateKey: (value?: string) => /^[A-Za-z0-9+/]{43}=$/.test(value || ''),
  dns: (value?: string) => {
    if (!value) return true;
    const ips = value.split(',').map(ip => ip.trim());
    return ips.every(ip => /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip));
  },
  keepalive: (value?: number) => typeof value === 'number' && value >= 15 && value <= 120
};

const DEFAULT_CONFIG = {
  privateKey: "YOUR_PRIVATE_KEY",
  dns: "103.86.96.100",
  keepalive: 25
};

const CONFIG_TEMPLATE = `[Interface]
PrivateKey={private_key}
Address=10.5.0.2/16
DNS={dns}

[Peer]
PublicKey={public_key}
AllowedIPs=0.0.0.0/0,::/0
Endpoint={endpoint}:51820
PersistentKeepalive={keepalive}`;

export function generateConfig(
  server: ProcessedServer, 
  publicKey: string,
  options: ConfigOptions = {}
): string {
  const endpoint = options.useStation ? server.station : server.hostname;
  
  // Format DNS entries with commas if multiple IPs are provided
  const dns = options.dns ? options.dns.split(',').map(ip => ip.trim()).join(', ') : DEFAULT_CONFIG.dns;
  
  return CONFIG_TEMPLATE
    .replace('{private_key}', options.privateKey || DEFAULT_CONFIG.privateKey)
    .replace('{dns}', dns)
    .replace('{public_key}', publicKey)
    .replace('{endpoint}', endpoint)
    .replace('{keepalive}', String(options.keepalive || DEFAULT_CONFIG.keepalive));
}
