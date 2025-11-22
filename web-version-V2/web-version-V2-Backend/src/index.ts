import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono-compress';
import { rateLimiter } from 'hono-rate-limiter';
import * as QRCode from 'qrcode';
import { Core } from './core/store';
import { buildWgConfig } from './core/wg';
import { validateConfig, validateToken } from './api/validate';

const app = new Hono<{ Bindings: { ip?: string } }>();

await Core.init();

const limiter = rateLimiter({
    windowMs: 60000,
    limit: 100,
    keyGenerator: (c) => c.req.header('x-test-key') || (c.env as any)?.ip || c.req.header('cf-connecting-ip') || 'ip',
});

app.use('*', cors());
app.use('/api/*', limiter);
if (process.env.NODE_ENV !== 'test') app.use('/api/*', compress());

app.get('/api/servers', (c) => {
    const { data, etag } = Core.getServerList();
    if (!data) return c.json({ error: 'Initializing' }, 503);
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(data as any, 200, { 'Content-Type': 'application/json; charset=utf-8' });
});

app.post('/api/key', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!validateToken(body.token)) return c.json({ error: 'Invalid token' }, 400);

    try {
        const res = await fetch('https://api.nordvpn.com/v1/users/services/credentials', {
            headers: { Authorization: `Bearer token:${body.token}` }
        });
        if (res.status === 401) return c.json({ error: 'Expired token' }, 401);
        if (!res.ok) throw new Error();
        const data = await res.json() as { nordlynx_private_key: string };
        return c.json({ key: data.nordlynx_private_key });
    } catch {
        return c.json({ error: 'Upstream error' }, 503);
    }
});

const handleConfig = async (c: any, type: 'text' | 'file' | 'qr') => {
    const body = await c.req.json().catch(() => ({}));
    const val = validateConfig(body);
    if (!val.ok) return c.json({ error: val.msg }, 400);

    const server = Core.getServer(val.data.name);
    if (!server) return c.json({ error: 'Server not found' }, 404);
    
    const pk = Core.getKey(server.keyId);
    if (!pk) return c.json({ error: 'Key missing' }, 500);

    const cfg = buildWgConfig(server, pk, val.data);
    c.header('Cache-Control', 'no-store');

    if (type === 'text') return c.text(cfg);
    if (type === 'file') {
        const fname = `${server.country.substring(0, 2)}${server.name.match(/\d+/)?.[0] || 'wg'}.conf`;
        c.header('Content-Disposition', `attachment; filename="${fname}"`);
        return c.body(cfg, 200, { 'Content-Type': 'application/x-wireguard-config' });
    }
    
    const buffer = await QRCode.toBuffer(cfg, { width: 256, margin: 1 });
    return c.body(buffer as any, 200, { 'Content-Type': 'image/png' });
};

app.post('/api/config', c => handleConfig(c, 'text'));
app.post('/api/config/download', c => handleConfig(c, 'file'));
app.post('/api/config/qr', c => handleConfig(c, 'qr'));

app.get('*', (c) => {
    const asset = Core.getAsset(c.req.path);
    
    if (!asset) {
        if (c.req.path.startsWith('/api')) return c.json({ message: 'Endpoint not found' }, 404);
        
        const index = Core.getAsset('/index.html');
        if (index) {
            c.header('Content-Type', 'text/html');
            return c.body(index.content as any);
        }
        return c.text('Not Found', 404);
    }

    if (c.req.header('if-none-match') === asset.etag) return c.body(null, 304);

    c.header('ETag', asset.etag);
    c.header('Content-Type', asset.mime);
    c.header('Cache-Control', c.req.path.startsWith('/assets') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');

    if (c.req.header('accept-encoding')?.includes('br') && asset.brotli) {
        c.header('Content-Encoding', 'br');
        return c.body(asset.brotli as any);
    }
    return c.body(asset.content as any);
});

export default { 
    port: 3000, 
    fetch: app.fetch 
};