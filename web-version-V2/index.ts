import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono-compress';
import { handleKeyRequest } from './src/endpoints/key';
import { handleConfigRequest, handleConfigQrRequest, handleConfigDownloadRequest } from './src/endpoints/config';
import { fetchServers, initializeCache, serverCache } from './src/services/serverService';
import { Logger } from './src/utils/logger';
import { generateConfig } from './src/services/configService';
import { serveStatic } from 'hono/bun';

try {
  Logger.clear();
  Logger.info('Server', 'Initializing cache before starting server');
  await initializeCache(); 
  Logger.info('Server', 'Cache initialized successfully, starting server');
} catch (error) {
  Logger.error('Server', 'Failed to initialize cache, starting server without initial cache', error);
}

const app = new Hono();
app.use('*', cors());
app.use(compress({
  encodings: ['br'], 
  brotliLevel: 2,    
  threshold: 512,   
}));

// Serve static files from public directory
app.use('/assets/*', serveStatic({ root: './public' }));
app.use('/*', serveStatic({ root: './public' }));

// Add cache control middleware
app.use('*', async (c, next) => {
  await next();
  // Add cache headers to all successful responses
  if (c.res.status < 400) {
    c.header('Cache-Control', 'public, max-age=300'); // 5 minutes cache
    c.header('Vary', 'Accept-Encoding');
  }
});

app.notFound((c) => c.json({ error: "Endpoint not found" }, 404));
app.post('/api/key', handleKeyRequest);
app.post('/api/config', handleConfigRequest);
app.post('/api/config/qr', handleConfigQrRequest);
app.post('/api/config/download', handleConfigDownloadRequest);

app.get('/api/servers', async (c) => {
  const cached = await fetchServers();
  c.header('ETag', cached.etag);
  
  if (c.req.header('If-None-Match') === cached.etag) {
    return new Response(null, { status: 304 });
  }
  
  return new Response(cached.data, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
});

export default {
  port: 3000,
  fetch: app.fetch,
};