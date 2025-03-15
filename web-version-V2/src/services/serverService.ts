import { Logger } from '../utils/logger';
import type { Context } from 'hono';

// Types
interface ServerResponse {
  name: string;
  station: string;
  hostname: string;
  load: number;
  locations: {
    country: {
      name: string;
      city: { name: string };
    };
  }[];
  technologies: {
    metadata: {
      name: string;
      value: string;
    }[];
  }[];
}

export interface ProcessedServer {
  name: string;
  station: string;
  hostname: string;
  load: number;
  keyId: number;
}

export interface SimpleServer {
  name: string;
  load: number;
}

export interface GroupedServers {
  [country: string]: {
    [city: string]: ProcessedServer[];
  };
}

interface CachedResponse {
  data: string;
  etag: string;
}

// Constants
const CACHE_CONFIG = {
  UPDATE_THRESHOLD: 4.5 * 60 * 1000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  CONTEXT: 'ServerCache'
} as const;

const API_URL = 'https://api.nordvpn.com/v1/servers?limit=8000&filters[servers_technologies][identifier]=wireguard_udp';

// Helper functions
const sanitizeName = (name: string): string => 
  name.toLowerCase()
    .replace(/[\/\\:*?"<>|#-]/g, '_')
    .split(' ')
    .filter(Boolean)
    .join('_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

class ServerCache {
  private mainCache: GroupedServers | null = null;
  private responseCache: CachedResponse | null = null;
  private lastUpdate = 0;
  private isUpdating = false;
  private keyMap = new Map<string, number>();
  private nextKeyId = 1;

  private async fetchFreshData(): Promise<GroupedServers> {
    let attempt = 0;

    while (attempt < CACHE_CONFIG.MAX_RETRIES) {
      try {
        Logger.info(CACHE_CONFIG.CONTEXT, `Fetching fresh server data (Attempt ${attempt + 1})`);
        const response = await fetch(API_URL);
        
        if (!response.ok) throw new Error(`API responded with status ${response.status}`);
        
        const data: ServerResponse[] = await response.json();
        Logger.info(CACHE_CONFIG.CONTEXT, `Successfully fetched ${data.length} servers`);
        
        const groupedServers = await this.processServerData(data);
        this.createResponseCache(groupedServers);
        return groupedServers;

      } catch (error) {
        attempt++;
        Logger.error(CACHE_CONFIG.CONTEXT, `Attempt ${attempt} failed`, error);
        
        if (attempt < CACHE_CONFIG.MAX_RETRIES) {
          Logger.info(CACHE_CONFIG.CONTEXT, `Retrying in ${CACHE_CONFIG.RETRY_DELAY}ms...`);
          await delay(CACHE_CONFIG.RETRY_DELAY);
        } else {
          Logger.error(CACHE_CONFIG.CONTEXT, 'All retry attempts failed');
          throw error;
        }
      }
    }

    return {};
  }

  private async processServerData(data: ServerResponse[]): Promise<GroupedServers> {
    const groupedServers: GroupedServers = {};
    
    for (const server of data) {
      const location = server.locations?.[0];
      if (!location) continue;

      const country = sanitizeName(location.country?.name || 'unknown');
      const city = sanitizeName(location.country?.city?.name || 'unknown');
      
      if (!groupedServers[country]) groupedServers[country] = {};
      if (!groupedServers[country][city]) groupedServers[country][city] = [];

      const publicKey = server.technologies
        ?.find(tech => tech.metadata?.some(meta => meta.name === 'public_key'))
        ?.metadata?.find(meta => meta.name === 'public_key')?.value;

      if (!publicKey) continue;

      let keyId = this.keyMap.get(publicKey);
      if (!keyId) {
        keyId = this.nextKeyId++;
        this.keyMap.set(publicKey, keyId);
      }

      groupedServers[country][city].push({
        name: sanitizeName(server.name),
        station: server.station,
        hostname: server.hostname,
        load: server.load,
        keyId
      });
    }

    return Object.keys(groupedServers)
      .sort()
      .reduce((acc, country) => {
        acc[country] = groupedServers[country];
        return acc;
      }, {} as GroupedServers);
  }

  private createResponseCache(servers: GroupedServers): void {
    const simplified = Object.entries(servers).reduce((acc, [country, cities]) => {
      acc[country] = Object.entries(cities).reduce((cityAcc, [city, serverList]) => {
        cityAcc[city] = serverList.map(({name, load}) => ({name, load}));
        return cityAcc;
      }, {} as Record<string, SimpleServer[]>);
      return acc;
    }, {} as Record<string, Record<string, SimpleServer[]>>);

    this.responseCache = {
      data: JSON.stringify(simplified),
      etag: `"${Date.now().toString(36)}"`
    };
  }

  private async backgroundUpdate(): Promise<void> {
    if (this.isUpdating) return;
    
    try {
      this.isUpdating = true;
      Logger.clear();
      const updateCount = Logger.incrementCacheUpdate();
      Logger.info(CACHE_CONFIG.CONTEXT, `Cache update #${updateCount} started`);
      
      this.mainCache = await this.fetchFreshData();
      this.lastUpdate = Date.now();
      
      Logger.info(CACHE_CONFIG.CONTEXT, `Cache update #${updateCount} completed`);
    } catch (error) {
      Logger.error(CACHE_CONFIG.CONTEXT, 'Cache update failed', error);
    } finally {
      this.isUpdating = false;
    }
  }

  public async initialize(): Promise<void> {
    try {
      Logger.clear();
      const updateCount = Logger.incrementCacheUpdate();
      Logger.info(CACHE_CONFIG.CONTEXT, `Initial cache population #${updateCount}`);
      
      this.mainCache = await this.fetchFreshData();
      this.lastUpdate = Date.now();
      
      Logger.info(CACHE_CONFIG.CONTEXT, `Initial cache population completed`);
      this.startPeriodicUpdate();
    } catch (error) {
      Logger.error(CACHE_CONFIG.CONTEXT, 'Failed to initialize cache', error);
      throw error;
    }
  }

  private startPeriodicUpdate(): void {
    setInterval(() => {
      if (!this.isUpdating && (Date.now() - this.lastUpdate) >= CACHE_CONFIG.UPDATE_THRESHOLD) {
        this.backgroundUpdate().catch(() => {});
      }
    }, CACHE_CONFIG.UPDATE_THRESHOLD);
  }

  public async getData(): Promise<GroupedServers> {
    if (!this.mainCache) return {};
    
    if ((Date.now() - this.lastUpdate) >= CACHE_CONFIG.UPDATE_THRESHOLD && !this.isUpdating) {
      this.backgroundUpdate().catch(() => {});
    }

    return this.mainCache;
  }

  public getCachedResponse(): CachedResponse | null {
    return this.responseCache;
  }

  public getPublicKeyById(keyId: number): string | undefined {
    for (const [key, id] of this.keyMap.entries()) {
      if (id === keyId) return key;
    }
    return undefined;
  }
}

export const serverCache = new ServerCache();

export async function initializeCache(): Promise<void> {
  await serverCache.initialize();
}

export async function fetchServers(): Promise<CachedResponse> {
  try {
    const cached = serverCache.getCachedResponse();
    if (!cached) {
      return {
        data: '{}',
        etag: `"${Date.now().toString(36)}"`
      };
    }
    
    serverCache.getData().catch(() => {});
    return cached;
  } catch {
    return {
      data: '{}',
      etag: `"${Date.now().toString(36)}"`
    };
  }
}