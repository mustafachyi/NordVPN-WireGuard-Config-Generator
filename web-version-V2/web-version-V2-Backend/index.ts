import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono-compress';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'fs';
import { join } from 'path';
import type { BunFile } from 'bun';

import { handleKeyRequest } from './src/endpoints/key';
import { 
  handleConfigRequest, 
  handleConfigQrRequest, 
  handleConfigDownloadRequest 
} from './src/endpoints/config';
import { fetchServers, initializeCache } from './src/services/serverService';
import { Logger } from './src/utils/logger';

// MIME type definitions
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const getMimeType = (path: string): string => 
  MIME_TYPES[path.substring(path.lastIndexOf('.'))] || 'application/octet-stream';

const createBrotliResponse = (file: BunFile, mimeType: string): Response => {
  const response = new Response(file);
  response.headers.set('Content-Encoding', 'br');
  response.headers.set('Content-Type', mimeType);
  response.headers.set('Vary', 'Accept-Encoding');
  return response;
};

// Initialize server
const initServer = async (): Promise<void> => {
  try {
    Logger.clear();
    Logger.info('Server', 'Initializing cache before starting server');
    await initializeCache();
    Logger.info('Server', 'Cache initialized successfully');
  } catch (error) {
    Logger.error('Server', 'Failed to initialize cache, starting without initial cache', error);
  }
};

// Create Hono app
const app = new Hono();

// Global middleware
app.use('*', cors());
app.use(compress({ encodings: ['br'], brotliLevel: 2, threshold: 512 }));

// Static file handlers
app.use('/assets/*', async (c, next) => {
  const path = c.req.path;
  const supportsBrotli = c.req.header('Accept-Encoding')?.includes('br');
  
  if (supportsBrotli) {
    const brPath = join('./public', `${path}.br`);
    if (existsSync(brPath)) {
      return createBrotliResponse(Bun.file(brPath), getMimeType(path));
    }
  }
  
  const response = await serveStatic({ root: './public' })(c, next);
  if (response?.status === 200) {
    response.headers.set('Content-Type', getMimeType(path));
  }
  return response;
});

// Root and HTML handler
app.use('/*', async (c, next) => {
  const path = c.req.path;
  const isIndex = path === '/' || path === '/index.html';
  const supportsBrotli = c.req.header('Accept-Encoding')?.includes('br');
  
  if (isIndex && supportsBrotli && existsSync('./public/index.html.br')) {
    return createBrotliResponse(Bun.file('./public/index.html.br'), 'text/html');
  }
  
  const response = await serveStatic({ root: './public' })(c, next);
  if (response?.status === 200) {
    response.headers.set('Content-Type', getMimeType(path));
  }
  return response;
});

// Cache control
app.use('*', async (c, next) => {
  await next();
  if (c.res.status < 400) {
    c.header('Cache-Control', 'public, max-age=300');
    c.header('Vary', 'Accept-Encoding');
  }
});

// API routes
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
    headers: { 'Content-Type': 'application/json' }
  });
});

// Error handling
app.notFound((c) => c.json({ error: "Endpoint not found" }, 404));

// Initialize and export
await initServer();

export default {
  port: 3000,
  fetch: app.fetch,
};