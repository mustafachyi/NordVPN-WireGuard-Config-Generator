import { Logger } from '../utils/logger';
import { writeFile } from 'fs/promises';

interface ServerResponse {
  name: string;
  station: string;
  hostname: string;
  load: number;
  locations: {
    country: {
      name: string;
      city: {
        name: string;
      };
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

export interface SimpleGroupedServers {
  [country: string]: {
    [city: string]: SimpleServer[];
  };
}


export interface GroupedServers {
  [country: string]: {
    [city: string]: ProcessedServer[];
  };
}
 

const sanitizeName = (name: string): string => {
  return name
    .toLowerCase()                         
    .replace(/[\/\\:\*\?"<>\|#]/g, '_')   
    .replace(/-/g, '_')                   
    .split(' ')                           
    .filter(Boolean)                      
    .join('_')                            
    .replace(/_+/g, '_')                  
    .replace(/^_|_$/g, '');              
};

interface CachedResponse {
  data: string;  
  etag: string;
}

class ServerCache {
  private mainCache: GroupedServers | null = null;
  private responseCache: CachedResponse | null = null;
  private lastUpdate: number = 0;
  private isUpdating: boolean = false;
  private readonly UPDATE_THRESHOLD = 4.5 * 60 * 1000;
  private readonly CONTEXT = 'ServerCache';
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;
  private keyMap = new Map<string, number>();  
  private nextKeyId: number = 1;

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchFreshData(): Promise<GroupedServers> {
    const url = 'https://api.nordvpn.com/v1/servers?limit=8000&filters[servers_technologies][identifier]=wireguard_udp';
    let attempt = 0;

    while (attempt < this.MAX_RETRIES) {
      try {
        Logger.info(this.CONTEXT, `Fetching fresh server data from NordVPN API (Attempt ${attempt + 1})`);
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }
        
        const data: ServerResponse[] = await response.json();
        Logger.info(this.CONTEXT, `Successfully fetched ${data.length} servers`);
        
        const groupedServers = await this.processServerData(data);
        
        
        this.createResponseCache(groupedServers);
        return groupedServers;
      } catch (error) {
        attempt++;
        Logger.error(this.CONTEXT, `Attempt ${attempt} failed: Failed to fetch fresh data`, error);
        if (attempt < this.MAX_RETRIES) {
          Logger.info(this.CONTEXT, `Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        } else {
          Logger.error(this.CONTEXT, 'All retry attempts failed. Unable to fetch fresh data.');
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
      if (keyId === undefined) {
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

    
    const sortedServers: GroupedServers = {};
    Object.keys(groupedServers)
      .sort((a, b) => a.localeCompare(b))
      .forEach(country => {
        sortedServers[country] = groupedServers[country];
      });

    return sortedServers;
  }

  private createResponseCache(servers: GroupedServers): void {
    const simplified: Record<string, Record<string, SimpleServer[]>> = {};
    
    for (const [country, cities] of Object.entries(servers)) {
      simplified[country] = {};
      for (const [city, serverList] of Object.entries(cities)) {
        simplified[country][city] = serverList.map(({name, load}) => ({name, load}));
      }
    }

    this.responseCache = {
      data: JSON.stringify(simplified),
      etag: `"${Date.now().toString(36)}"`
    };
  }

  private cleanupOldData(): void {
    const unusedKeys = new Set(this.keyMap.keys());
    
    if (this.mainCache) {
      for (const cities of Object.values(this.mainCache)) {
        for (const servers of Object.values(cities)) {
          for (const server of servers) {
            for (const [key, id] of this.keyMap.entries()) {
              if (id === server.keyId) {
                unusedKeys.delete(key);
              }
            }
          }
        }
      }
    }
    
    unusedKeys.forEach(key => this.keyMap.delete(key));
    global.gc?.();
  }

  private clearCache(): void {
    this.mainCache = null;
    this.responseCache = null;
    this.keyMap.clear();
  }

  private async backgroundUpdate() {
    if (this.isUpdating) return;
    
    try {
      this.isUpdating = true;
      Logger.clear();
      const updateCount = Logger.incrementCacheUpdate();
      Logger.info(this.CONTEXT, `Cache update #${updateCount} started`);
      
      this.clearCache();
      const freshData = await this.fetchFreshData();
      this.mainCache = freshData;
      this.lastUpdate = Date.now();
      
      Logger.info(this.CONTEXT, `Cache update #${updateCount} completed`);
    } catch (error) {
      Logger.error(this.CONTEXT, 'Cache update failed', error);
    } finally {
      this.isUpdating = false;
    }
  }

  public async initialize(): Promise<void> {
    try {
      Logger.clear();
      const updateCount = Logger.incrementCacheUpdate();
      Logger.info(this.CONTEXT, `Initializing cache during startup (Update #${updateCount})`);
      this.clearCache();
      const freshData = await this.fetchFreshData();
      this.mainCache = freshData;
      this.lastUpdate = Date.now();
      Logger.info(this.CONTEXT, `Initial cache population #${updateCount} completed successfully`);
       
      /* Debug dumps - uncomment if needed
      try {
        const cacheJson = JSON.stringify(this.mainCache, null, 2);
        await writeFile('cache_dump.json', cacheJson);
        const keys = Array.from(this.keyMap.entries()).map(([key, id]) => ({ key, id }));
        await writeFile('keys_dump.json', JSON.stringify(keys, null, 2));
        Logger.info(this.CONTEXT, 'Cache and keys have been saved to cache_dump.json and keys_dump.json for debugging purposes');
      } catch (fileError) {
        Logger.error(this.CONTEXT, 'Failed to write cache or keys to file', fileError);
      }
      */

      this.startPeriodicUpdate();
    } catch (error) {
      Logger.error(this.CONTEXT, 'Failed to initialize cache during startup', error);
      throw error;
    }
  }

  private startPeriodicUpdate(): void {
    setInterval(() => {
      if (!this.isUpdating) {
        this.backgroundUpdate().catch(() => {});
      }
    }, this.UPDATE_THRESHOLD);
  }

  public async getData(): Promise<GroupedServers> {
    if (!this.mainCache) return {};
    
    if ((Date.now() - this.lastUpdate) >= this.UPDATE_THRESHOLD && !this.isUpdating) {
      this.backgroundUpdate().catch(() => {});
    }

    return this.mainCache;
  }

  public async getSimplifiedData(): Promise<SimpleGroupedServers> {
    if (!this.responseCache) {
      Logger.warn(this.CONTEXT, 'Simplified cache accessed before initialization, returning empty result');
      return {};
    }
    return JSON.parse(this.responseCache.data);
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

const serverCache = new ServerCache();

export { serverCache };
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