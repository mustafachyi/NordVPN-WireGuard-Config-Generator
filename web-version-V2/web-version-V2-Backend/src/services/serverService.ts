import { Logger } from '../utils/logger';
import { htmlService } from './htmlService';

interface RawServer {
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

type ServerDataTuple = [string, number, string];

interface CityToServerMap {
    [city: string]: ServerDataTuple[];
}

interface CountryToCityMap {
    [country: string]: CityToServerMap;
}

interface LeanServerList {
    h: ['name', 'load', 'station'];
    l: CountryToCityMap;
}

const NORDVPN_API_URL = 'https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp';
const LOG_CONTEXT = 'ServerCache';
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

class ServerCache {
    private serversByName = new Map<string, ProcessedServer>();
    private publicKeys = new Map<number, string>();
    private leanPayload: Buffer | null = null;
    private lastUpdated = 0;
    private isUpdating = false;
    private updateTimer: Timer | null = null;
    private nextKeyId = 1;

    private static sanitize(name: string): string {
        return name.toLowerCase().replace(/[\s/\\:*?"<>|#]+/g, '_');
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
            const newServersByName = new Map<string, ProcessedServer>();
            const newPublicKeys = new Map<string, number>();
            const leanList: LeanServerList = { h: ['name', 'load', 'station'], l: {} };
            this.publicKeys.clear();
            this.nextKeyId = 1;

            for (const server of rawData) {
                const location = server.locations[0];
                const publicKeyMeta = server.technologies.flatMap(t => t.metadata).find(m => m.name === 'public_key');
                if (!location?.country?.name || !location?.country?.city?.name || !publicKeyMeta?.value) {
                    continue;
                }

                const publicKey = publicKeyMeta.value;
                let keyId = newPublicKeys.get(publicKey);
                if (keyId === undefined) {
                    keyId = this.nextKeyId++;
                    newPublicKeys.set(publicKey, keyId);
                    this.publicKeys.set(keyId, publicKey);
                }

                const country = ServerCache.sanitize(location.country.name);
                const city = ServerCache.sanitize(location.country.city.name);
                const name = ServerCache.sanitize(server.name);

                const processedServer: ProcessedServer = {
                    name,
                    station: server.station,
                    hostname: server.hostname,
                    load: server.load,
                    keyId,
                };
                newServersByName.set(name, processedServer);

                const countryGroup = (leanList.l[country] ||= {});
                const cityGroup = (countryGroup[city] ||= []);
                cityGroup.push([name, server.load, server.station]);
            }

            this.serversByName = newServersByName;
            this.leanPayload = Buffer.from(JSON.stringify(leanList));
            this.lastUpdated = Date.now();
            
            htmlService.updateInjectedHtml(this.leanPayload);
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

    public getServerByName(name: string): ProcessedServer | undefined {
        return this.serversByName.get(name);
    }

    public getLeanPayload(): Buffer | null {
        return this.leanPayload;
    }
}

const serverCacheManager = new ServerCache();
export const initializeCache = () => serverCacheManager.initialize();
export const serverCache = serverCacheManager;