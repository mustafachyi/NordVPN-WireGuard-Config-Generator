import { Logger } from '../utils/logger';

interface RawServer {
    name: string;
    station: string;
    hostname: string;
    load: number;
    locations: { country: { name:string; city: { name: string } } }[];
    technologies: { metadata: { name: string; value: string }[] }[];
}

export interface ProcessedServer {
    name: string;
    station: string;
    hostname: string;
    load: number;
    keyId: number;
}

export interface GroupedServers {
    [country: string]: { [city: string]: ProcessedServer[] };
}

type ServerDataTuple = [string, number, string];

interface CityToServerMap {
    [city: string]: ServerDataTuple[];
}

interface CountryToCityMap {
    [country: string]: CityToServerMap;
}

export interface LeanServerList {
    h: ['name', 'load', 'station'];
    l: CountryToCityMap;
}

const NORDVPN_API_URL = 'https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp';
const LOG_CONTEXT = 'ServerCache';
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

class ServerCache {
    private cache: GroupedServers = {};
    private leanCache: LeanServerList | null = null;
    private publicKeys = new Map<number, string>();
    private lastUpdated = 0;
    private isUpdating = false;
    private updateTimer: Timer | null = null;
    private nextKeyId = 1;

    private static sanitize(name: string): string {
        return name.toLowerCase().replace(/[\s/\\:*?"<>|#]+/g, '_');
    }

    private transform(servers: RawServer[]): GroupedServers {
        const grouped: GroupedServers = {};
        const keyLookup = new Map<string, number>();
        this.publicKeys.clear();
        this.nextKeyId = 1;

        for (const server of servers) {
            const location = server.locations[0];
            const publicKeyMeta = server.technologies.flatMap(t => t.metadata).find(m => m.name === 'public_key');
            if (!location?.country?.name || !location?.country?.city?.name || !publicKeyMeta?.value) {
                continue;
            }

            const publicKey = publicKeyMeta.value;
            let keyId = keyLookup.get(publicKey);
            if (keyId === undefined) {
                keyId = this.nextKeyId++;
                keyLookup.set(publicKey, keyId);
                this.publicKeys.set(keyId, publicKey);
            }

            const country = ServerCache.sanitize(location.country.name);
            const city = ServerCache.sanitize(location.country.city.name);

            (grouped[country] ||= {})[city] ||= [];
            grouped[country][city].push({
                name: ServerCache.sanitize(server.name),
                station: server.station,
                hostname: server.hostname,
                load: server.load,
                keyId,
            });
        }
        return grouped;
    }

    private computeLeanList(fullData: GroupedServers): LeanServerList {
        const locations = Object.fromEntries(
            Object.entries(fullData).map(([country, cities]) => [
                country,
                Object.fromEntries(
                    Object.entries(cities).map(([city, servers]) => [
                        city,
                        servers.map(s => [s.name, s.load, s.station] as ServerDataTuple),
                    ])
                ),
            ])
        );
        return {
            h: ['name', 'load', 'station'],
            l: locations,
        };
    }

    private async fetchWithRetry(): Promise<RawServer[]> {
        for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(NORDVPN_API_URL);
                if (!response.ok) throw new Error(`API error: ${response.status}`);
                return await response.json() as RawServer[];
            } catch (error) {
                Logger.warn(LOG_CONTEXT, `Fetch attempt ${attempt} failed.`);
                if (attempt === RETRY_ATTEMPTS) {
                    Logger.error(LOG_CONTEXT, 'All fetch attempts failed.', error);
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
        return [];
    }
    
    private async updateCache(): Promise<void> {
        if (this.isUpdating) return;
        this.isUpdating = true;
        Logger.info(LOG_CONTEXT, 'Starting server data update.');

        try {
            const rawData = await this.fetchWithRetry();
            this.cache = this.transform(rawData);
            this.leanCache = this.computeLeanList(this.cache);
            this.lastUpdated = Date.now();
            Logger.info(LOG_CONTEXT, 'Cache update successful.');
        } catch (error) {
            Logger.error(LOG_CONTEXT, 'Cache update failed.', error);
        } finally {
            this.isUpdating = false;
        }
    }

    public async initialize(): Promise<void> {
        await this.updateCache();
        if (this.updateTimer) clearInterval(this.updateTimer);
        this.updateTimer = setInterval(() => this.updateCache(), UPDATE_INTERVAL_MS);
    }

    public getEtag(): string {
        return `W/"${this.lastUpdated.toString(36)}"`;
    }

    public getPublicKey(keyId: number): string | undefined {
        return this.publicKeys.get(keyId);
    }

    public async getServers(): Promise<GroupedServers> {
        if (this.lastUpdated === 0) {
            await this.initialize();
        }
        return this.cache;
    }

    public async getLeanServers(): Promise<LeanServerList | null> {
        if (this.lastUpdated === 0) {
            await this.initialize();
        }
        return this.leanCache;
    }
}

const serverCacheManager = new ServerCache();
export const initializeCache = () => serverCacheManager.initialize();
export const serverCache = serverCacheManager;