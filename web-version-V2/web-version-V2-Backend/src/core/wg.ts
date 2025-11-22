import type { ProcessedServer, ValidatedConfig } from '../types';

export const buildWgConfig = (server: ProcessedServer, pubKey: string, opts: ValidatedConfig): string => `[Interface]
PrivateKey=${opts.privateKey}
Address=10.5.0.2/16
DNS=${opts.dns}

[Peer]
PublicKey=${pubKey}
AllowedIPs=0.0.0.0/0,::/0
Endpoint=${opts.useStation ? server.station : server.hostname}:51820
PersistentKeepalive=${opts.keepalive}`;