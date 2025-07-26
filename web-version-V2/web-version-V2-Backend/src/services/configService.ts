import type { ProcessedServer } from "./serverService";

// Constants
const DEFAULT_CONFIG = {
  privateKey: "YOUR_PRIVATE_KEY",
  dns: "103.86.96.100",
  keepalive: 25
} as const;

const CONFIG_TEMPLATE = `[Interface]
PrivateKey={private_key}
Address=10.5.0.2/16
DNS={dns}

[Peer]
PublicKey={public_key}
AllowedIPs=0.0.0.0/0,::/0
Endpoint={endpoint}:51820
PersistentKeepalive={keepalive}` as const;

// Types
export interface ConfigOptions {
  privateKey?: string;
  dns?: string;
  useStation?: boolean;
  keepalive?: number;
}

// Validation patterns
const PATTERNS = {
  privateKey: /^[A-Za-z0-9+/]{43}=$/,
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
} as const;

// Validation functions
export const CONFIG_VALIDATION = {
  privateKey: (value?: string): boolean => 
    !value || PATTERNS.privateKey.test(value),

  dns: (value?: string): boolean => 
    !value || value.split(',')
      .map(ip => ip.trim())
      .every(ip => PATTERNS.ipv4.test(ip)),

  keepalive: (value?: number): boolean => 
    typeof value === 'undefined' || (value >= 15 && value <= 120)
} as const;

/**
 * Generates WireGuard configuration
 * @param server - Server configuration
 * @param publicKey - Server's public key
 * @param options - Configuration options
 */
export function generateConfig(
  server: ProcessedServer, 
  publicKey: string,
  { 
    privateKey = DEFAULT_CONFIG.privateKey,
    dns = DEFAULT_CONFIG.dns,
    useStation = false,
    keepalive = DEFAULT_CONFIG.keepalive 
  }: ConfigOptions = {}
): string {
  const endpoint = useStation ? server.station : server.hostname;
  const formattedDns = dns.split(',').map(ip => ip.trim()).join(', ');

  return CONFIG_TEMPLATE
    .replace('{private_key}', privateKey)
    .replace('{dns}', formattedDns)
    .replace('{public_key}', publicKey)
    .replace('{endpoint}', endpoint)
    .replace('{keepalive}', String(keepalive));
}
