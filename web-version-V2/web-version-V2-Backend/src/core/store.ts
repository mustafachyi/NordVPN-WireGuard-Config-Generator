import { join, relative } from 'path';
import { readdir } from 'node:fs/promises';
import { brotliCompressSync } from 'node:zlib';
import { getMimeType } from 'hono/utils/mime';
import { Log } from '../lib/logger';
import type { Asset, ProcessedServer, RawServer, ServerPayload } from '../types';

const API_URL = 'https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp';
const PUBLIC_DIR = './public';
const REFRESH_MS = 300_000;

class Store {
    private assets = new Map<string, Asset>();
    private servers = new Map<string, ProcessedServer>();
    private keys = new Map<number, string>();
    private keyIdCounter = 1;
    
    private serverJson: Buffer | null = null;
    private serverEtag = '';
    
    private indexRaw: string | null = null;
    private indexAsset: Asset | null = null;

    async init() {
        Log.info('Store', 'Initializing...');
        await this.loadAssets(PUBLIC_DIR);
        await this.updateServers();
        setInterval(() => this.updateServers(), REFRESH_MS);
        Log.info('Store', 'Ready.');
    }

    private async loadAssets(dir: string) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.loadAssets(path);
                continue;
            }
            if (entry.name.endsWith('.br')) continue;

            const content = Buffer.from(await Bun.file(path).arrayBuffer());
            const webPath = '/' + relative(PUBLIC_DIR, path).replace(/\\/g, '/');
            
            if (webPath === '/index.html') {
                this.indexRaw = content.toString('utf-8');
                continue;
            }

            const preCompressed = Bun.file(path + '.br');
            const brotli = await preCompressed.exists() 
                ? Buffer.from(await preCompressed.arrayBuffer()) 
                : brotliCompressSync(content);

            this.assets.set(webPath, {
                content,
                brotli,
                mime: getMimeType(entry.name) || 'application/octet-stream',
                etag: `W/"${content.length.toString(16)}-${Date.now().toString(16)}"`
            });
        }
    }

    private async updateServers() {
        try {
            Log.info('Store', 'Updating server list...');
            const res = await fetch(API_URL);
            if (!res.ok) throw new Error(res.statusText);
            
            const raw: RawServer[] = await res.json();
            const newServers = new Map<string, ProcessedServer>();
            const newKeys = new Map<string, number>();
            const keyMap = new Map<number, string>();
            const payload: ServerPayload = { h: ['name', 'load', 'station'], l: {} };
            
            let kId = 1;

            for (const s of raw) {
                const loc = s.locations[0];
                const keyMeta = s.technologies.flatMap(t => t.metadata).find(m => m.name === 'public_key');
                
                if (!loc?.country?.code || !keyMeta?.value) continue;

                const pk = keyMeta.value;
                let id = newKeys.get(pk);
                if (!id) {
                    id = kId++;
                    newKeys.set(pk, id);
                    keyMap.set(id, pk);
                }

                const name = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                const country = loc.country.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                const city = loc.country.city.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

                newServers.set(name, {
                    name,
                    station: s.station,
                    hostname: s.hostname,
                    country,
                    city,
                    keyId: id
                });

                ((payload.l[country] ||= {})[city] ||= []).push([name, s.load, s.station]);
            }

            this.servers = newServers;
            this.keys = keyMap;
            this.serverJson = Buffer.from(JSON.stringify(payload));
            this.serverEtag = `W/"${Date.now().toString(36)}"`;
            
            this.rebuildIndex();
            Log.info('Store', `Cached ${newServers.size} servers.`);
        } catch (e) {
            Log.error('Store', 'Update failed', e);
        }
    }

    private rebuildIndex() {
        if (!this.indexRaw) return;
        const script = `<script id="server-data" type="application/json">${this.serverJson?.toString() || '{}'}</script>`;
        const html = this.indexRaw.replace('</body>', `${script}</body>`);
        const buf = Buffer.from(html);
        
        this.indexAsset = {
            content: buf,
            brotli: brotliCompressSync(buf),
            mime: 'text/html; charset=utf-8',
            etag: this.serverEtag
        };
    }

    getAsset(path: string) {
        return path === '/' || path === '/index.html' ? this.indexAsset : this.assets.get(path);
    }

    getServerList() {
        return { data: this.serverJson, etag: this.serverEtag };
    }

    getServer(name: string) { return this.servers.get(name); }
    getKey(id: number) { return this.keys.get(id); }
}

export const Core = new Store();