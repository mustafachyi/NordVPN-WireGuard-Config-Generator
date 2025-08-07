import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { rateLimiter } from 'hono-rate-limiter';
import { compress } from 'hono-compress';
import type { Server } from 'bun';
import { createConfigHandler } from './src/endpoints/config';
import { handleKeyRequest } from './src/endpoints/key';
import { initializeCache, serverCache } from './src/services/serverService';
import { htmlService } from './src/services/htmlService';
import { assetService } from './src/services/assetService';
import { memoryAsset } from './src/middleware/memoryAsset';
import { Logger } from './src/utils/logger';

interface HonoEnv {
    Bindings: {
        ip?: string;
    };
}

const app = new Hono<HonoEnv>();

const limiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-6',
    keyGenerator: (context: Context<HonoEnv>) =>
        context.req.header('x-test-key') ?? context.env.ip ?? 'default',
});

app.use('*', cors());
app.use('*', memoryAsset());
app.use('/api/*', limiter);

if (process.env.NODE_ENV !== 'test') {
    app.use('/api/*', compress());
}

app.get('/api/servers', async (context) => {
    const requestEtag = context.req.header('if-none-match');
    const currentEtag = serverCache.getEtag();

    if (requestEtag === currentEtag) {
        return context.body(null, 304);
    }

    const serversPayload = serverCache.getLeanPayload();

    if (!serversPayload) {
        return context.json({ message: 'Service Unavailable: Server list is being updated.' }, 503);
    }

    context.header('ETag', currentEtag);
    context.header('Cache-Control', 'public, max-age=300');
    context.header('Content-Type', 'application/json; charset=utf-8');

    return context.body(serversPayload);
});

app.post('/api/key', handleKeyRequest);
app.post('/api/config', createConfigHandler('text'));
app.post('/api/config/download', createConfigHandler('download'));
app.post('/api/config/qr', createConfigHandler('qr'));

app.notFound((context) => context.json({ message: 'Endpoint not found.' }, 404));

app.onError((error, context) => {
    Logger.error('HonoError', 'An unhandled application error occurred.', error);
    return context.json({ message: 'An internal server error occurred.' }, 500);
});

const startServer = async () => {
    try {
        Logger.info('Server', 'Initializing services...');
        await assetService.initialize();
        await htmlService.initialize();
        await initializeCache();
        Logger.info('Server', 'Services initialized successfully.');
    } catch (error) {
        Logger.error('Server', 'Fatal: Service initialization failed.', error);
        process.exit(1);
    }
};

if (process.env.NODE_ENV !== 'test') {
    await startServer();
}

const rootResponseHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
};

const compressedRootResponseHeaders = {
    ...rootResponseHeaders,
    'Content-Encoding': 'br',
};

export { app, initializeCache as initializeTestCache };
export default {
    port: 3000,
    fetch: (request: Request, server: Server): Response | Promise<Response> => {
        if (request.method === 'GET' && new URL(request.url).pathname === '/') {
            const acceptsBrotli = request.headers.get('Accept-Encoding')?.includes('br');
            
            if (acceptsBrotli) {
                const compressedBody = htmlService.getCompressedInjectedHtml();
                if (compressedBody) {
                    return new Response(compressedBody, {
                        headers: compressedRootResponseHeaders,
                    });
                }
            }
            
            return new Response(htmlService.getInjectedHtml(), {
                headers: rootResponseHeaders,
            });
        }

        const env: HonoEnv['Bindings'] = {
            ip: server.requestIP(request)?.address,
        };
        return app.fetch(request, env);
    },
};