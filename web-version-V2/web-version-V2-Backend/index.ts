import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { rateLimiter } from 'hono-rate-limiter';
import { compress } from 'hono-compress';
import type { Server } from 'bun';
import { createConfigHandler } from './src/endpoints/config';
import { handleKeyRequest } from './src/endpoints/key';
import { initializeCache, serverCache } from './src/services/serverService';
import { Logger } from './src/utils/logger';
import { precompressed } from './src/middleware/precompressed';

interface HonoEnv {
    Bindings: {
        ip?: string;
    };
}

const app = new Hono<HonoEnv>();

const ONE_YEAR_IN_SECONDS = 31536000;

const limiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-6',
    keyGenerator: (context: Context<HonoEnv>) =>
        context.req.header('x-test-key') ?? context.env.ip ?? 'default',
});

const staticAssetCacheMiddleware = async (context: Context, next: Next) => {
    if (context.req.path.startsWith('/assets')) {
        context.header('Cache-Control', `public, max-age=${ONE_YEAR_IN_SECONDS}, immutable`);
    }
    await next();
};

app.use('*', cors());
app.use('/api/*', limiter);
app.use('*', staticAssetCacheMiddleware);

if (process.env.NODE_ENV !== 'test') {
    app.use('/api/*', compress());
}

app.get('/api/servers', async (context) => {
    const requestEtag = context.req.header('if-none-match');
    const currentEtag = serverCache.getEtag();

    if (requestEtag === currentEtag) {
        return context.body(null, 304);
    }

    const servers = await serverCache.getLeanServers();
    context.header('ETag', currentEtag);
    context.header('Cache-Control', 'public, max-age=300');
    context.header('Content-Type', 'application/json; charset=utf-8');

    const minifiedPayload = JSON.stringify(servers);
    return context.body(minifiedPayload);
});

app.post('/api/key', handleKeyRequest);
app.post('/api/config', createConfigHandler('text'));
app.post('/api/config/download', createConfigHandler('download'));
app.post('/api/config/qr', createConfigHandler('qr'));

if (process.env.NODE_ENV !== 'test') {
    app.use('*', precompressed({ root: './public', index: 'index.html' }));
}

app.notFound((context) => context.json({ message: 'Endpoint not found.' }, 404));

app.onError((error, context) => {
    Logger.error('HonoError', 'An unhandled application error occurred.', error);
    return context.json({ message: 'An internal server error occurred.' }, 500);
});

app.get('*', serveStatic({ root: './public' }));

const startServer = async () => {
    try {
        Logger.info('Server', 'Initializing server cache...');
        await initializeCache();
        Logger.info('Server', 'Cache initialized successfully.');
    } catch (error) {
        Logger.error('Server', 'Fatal: Cache initialization failed.', error);
        process.exit(1);
    }
};

if (process.env.NODE_ENV !== 'test') {
    await startServer();
}

export { app, initializeCache as initializeTestCache };
export default {
    port: 3000,
    fetch: (request: Request, server: Server): Response | Promise<Response> => {
        const env: HonoEnv['Bindings'] = {
            ip: server.requestIP(request)?.address,
        };
        return app.fetch(request, env);
    },
};