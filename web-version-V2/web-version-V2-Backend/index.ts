import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono-compress';
import { serveStatic } from 'hono/bun';
import { rateLimiter } from 'hono-rate-limiter';
import type { Server } from 'bun';
import { createConfigHandler } from './src/endpoints/config.ts';
import { handleKeyRequest } from './src/endpoints/key.ts';
import { initializeCache, serverCache } from './src/services/serverService.ts';
import { Logger } from './src/utils/logger.ts';

type Env = {
    Bindings: {
        ip?: string;
    };
};

const app = new Hono<Env>();

const initializeCacheManager = async (): Promise<void> => {
    try {
        Logger.info('Server', 'Initializing server cache...');
        await initializeCache();
        Logger.info('Server', 'Cache initialized successfully.');
    } catch (error) {
        Logger.error('Server', 'Cache initialization failed.', error);
    }
};

const limiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-6',
  keyGenerator: (c: Context<Env>) => {
    const testKey = c.req.header('x-test-key');
    if (testKey) {
        return testKey;
    }
    return c.env.ip || 'default';
  },
});

app.use('*', cors());
app.use('*', compress());
app.use('/api/*', limiter);

app.get(
    '*',
    serveStatic({
        root: './public',
        rewriteRequestPath: (path) => (path === '/' ? '/index.html' : path),
    })
);

app.get('/api/servers', async (c) => {
    const etag = c.req.header('if-none-match');
    const currentEtag = serverCache.getEtag();

    if (etag === currentEtag) {
        return c.body(null, 304);
    }

    const simplifiedData = await serverCache.getSimplifiedData();

    c.header('ETag', currentEtag);
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(simplifiedData);
});

app.post('/api/key', handleKeyRequest);
app.post('/api/config', createConfigHandler('text'));
app.post('/api/config/download', createConfigHandler('download'));
app.post('/api/config/qr', createConfigHandler('qr'));

app.notFound((c) => c.json({ error: 'Endpoint not found' }, 404));

app.onError((err, c) => {
    Logger.error('UnhandledError', 'An unhandled error occurred', err);
    return c.json({ error: 'Internal Server Error' }, 500);
});

if (process.env.NODE_ENV !== 'test') {
    await initializeCacheManager();
}

export { app, initializeCacheManager };
export default {
    port: 3000,
    fetch: (req: Request, server: Server) => {
        const env: Env['Bindings'] = {
            ip: server.requestIP(req)?.address,
        };
        return app.fetch(req, env);
    },
};