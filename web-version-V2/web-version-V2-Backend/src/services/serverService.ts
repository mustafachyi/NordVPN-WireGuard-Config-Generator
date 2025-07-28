import { Logger } from '../utils/logger';

interface RawNordVpnServer {
    name: string;
    station: string;
    hostname: string;
    load: number;
    locations: { country: { name: string; city: { name: string } } }[];
    technologies: { metadata: { name: string; value: string }[] }[];
}

export interface ProcessedServer {
    name: string;
    station: string;
    hostname: string;
    load: number;
    keyId: number;
}

export interface SimplifiedServer {
    name: string;
    load: number;
    ip: string;
}

export interface GroupedServers {
    [country: string]: { [city:string]: ProcessedServer[] };
}

export interface SimplifiedGroupedServers {
    [country: string]: { [city: string]: SimplifiedServer[] };
}

const CACHE_LIFESPAN_MS = 4.5 * 60 * 1000;
const API_RETRY_ATTEMPTS = 3;
const API_RETRY_DELAY_MS = 1000;
const NORDVPN_SERVERS_URL = 'https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp';
const LOG_CONTEXT = 'ServerCache';

class ServerCacheManager {
    private mainCache: GroupedServers | null = null;
    private publicKeyMap = new Map<number, string>();
    private nextKeyId = 1;
    private lastUpdateTime = 0;
    private isUpdating = false;
    private updateTimer: Timer | null = null;

    private static sanitizeName(name: string): string {
        return name.toLowerCase().replace(/[\s\/\\:*?"<>|#]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    }

    private async fetchAndProcessData(): Promise<GroupedServers> {
        for (let i = 0; i < API_RETRY_ATTEMPTS; i++) {
            try {
                const response = await fetch(NORDVPN_SERVERS_URL);
                if (!response.ok) {
                    throw new Error(`API error status: ${response.status}`);
                }
                const rawData = (await response.json()) as RawNordVpnServer[];
                return this.transformRawData(rawData);
            } catch (error) {
                Logger.warn(LOG_CONTEXT, `Fetch attempt ${i + 1} failed. Retrying...`);
                if (i < API_RETRY_ATTEMPTS - 1) {
                    await new Promise(resolve => setTimeout(resolve, API_RETRY_DELAY_MS));
                } else {
                    Logger.error(LOG_CONTEXT, 'All fetch attempts failed.', error);
                    throw error;
                }
            }
        }
        return {};
    }

    private transformRawData(rawData: RawNordVpnServer[]): GroupedServers {
        const grouped: GroupedServers = {};
        const keyLookup = new Map<string, number>();

        for (const server of rawData) {
            const location = server.locations[0];
            const publicKey = server.technologies.flatMap(t => t.metadata).find(m => m.name === 'public_key')?.value;
            if (!location || !publicKey) continue;

            const country = ServerCacheManager.sanitizeName(location.country.name);
            const city = ServerCacheManager.sanitizeName(location.country.city.name);

            let keyId = keyLookup.get(publicKey);
            if (keyId === undefined) {
                keyId = this.nextKeyId++;
                keyLookup.set(publicKey, keyId);
                this.publicKeyMap.set(keyId, publicKey);
            }

            (grouped[country] ||= {})[city] ||= [];
            grouped[country][city].push({
                name: ServerCacheManager.sanitizeName(server.name),
                station: server.station,
                hostname: server.hostname,
                load: server.load,
                keyId,
            });
        }
        return grouped;
    }

    private async performUpdate(): Promise<void> {
        if (this.isUpdating) return;
        this.isUpdating = true;
        Logger.info(LOG_CONTEXT, 'Starting background cache update.');
        try {
            const freshData = await this.fetchAndProcessData();
            this.mainCache = freshData;
            this.lastUpdateTime = Date.now();
            Logger.info(LOG_CONTEXT, 'Cache update completed successfully.');
        } catch (error) {
            Logger.error(LOG_CONTEXT, 'Background cache update failed.', error);
        } finally {
            this.isUpdating = false;
        }
    }

    public async initialize(): Promise<void> {
        await this.performUpdate();
        if (this.updateTimer) clearInterval(this.updateTimer);
        this.updateTimer = setInterval(() => this.performUpdate(), CACHE_LIFESPAN_MS);
    }

    public async getData(): Promise<GroupedServers> {
        if (!this.mainCache) {
            await this.initialize();
        } else if (Date.now() - this.lastUpdateTime > CACHE_LIFESPAN_MS) {
            this.performUpdate();
        }
        return this.mainCache ?? {};
    }

    public async getSimplifiedData(): Promise<SimplifiedGroupedServers> {
        const data = await this.getData();
        return Object.fromEntries(
            Object.entries(data).map(([country, cities]) => [
                country,
                Object.fromEntries(
                    Object.entries(cities).map(([city, servers]) => [
                        city,
                        servers.map(s => ({ name: s.name, load: s.load, ip: s.station })),
                    ])
                ),
            ])
        );
    }
    
    public getEtag(): string { return `W/"${this.lastUpdateTime.toString(36)}"` }
    public getPublicKeyById(keyId: number): string | undefined { return this.publicKeyMap.get(keyId); }
}

export const serverCache = new ServerCacheManager();
export const initializeCache = () => serverCache.initialize();