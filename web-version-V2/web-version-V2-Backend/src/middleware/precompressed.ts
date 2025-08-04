import type { Context, Next } from 'hono';
import { getMimeType } from 'hono/utils/mime';
import { join } from 'path';

interface PrecompressedOptions {
    root: string;
    index?: string;
}

export const precompressed = (options: PrecompressedOptions = { root: '', index: 'index.html' }) => {
    return async (context: Context, next: Next) => {
        if (context.req.method !== 'GET' && context.req.method !== 'HEAD') {
            return next();
        }

        const url = new URL(context.req.url);
        let path = url.pathname;
        if (path.startsWith('/api')) {
            return next();
        }

        if (path.endsWith('/')) {
            path = `${path}${options.index}`;
        }
        
        const acceptsBrotli = context.req.header('Accept-Encoding')?.includes('br');
        if (!acceptsBrotli) {
            return next();
        }
        
        const compressedPath = join(options.root, `${path}.br`);
        const file = Bun.file(compressedPath);
        const exists = await file.exists();

        if (exists) {
            const mimeType = getMimeType(path) ?? 'application/octet-stream';
            context.header('Content-Encoding', 'br');
            context.header('Content-Type', mimeType);
            context.header('Vary', 'Accept-Encoding');

            if (context.req.method === 'HEAD') {
                return context.body(null);
            }

            return context.body(file.stream());
        }

        await next();
    };
};