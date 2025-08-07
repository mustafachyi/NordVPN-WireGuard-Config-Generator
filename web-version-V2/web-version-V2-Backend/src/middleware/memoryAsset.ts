import type { Context, Next } from 'hono';
import { assetService } from '../services/assetService';

const ONE_YEAR_IN_SECONDS = 31536000;

export const memoryAsset = () => {
    return async (context: Context, next: Next) => {
        if (context.req.method !== 'GET' && context.req.method !== 'HEAD') {
            return next();
        }

        const path = new URL(context.req.url).pathname;
        if (path.startsWith('/api')) {
            return next();
        }

        const asset = assetService.get(path);
        if (!asset) {
            return next();
        }

        const requestEtag = context.req.header('if-none-match');
        if (requestEtag === asset.etag) {
            return context.body(null, 304);
        }

        context.header('Content-Type', asset.mimeType);
        context.header('ETag', asset.etag);
        context.header('Vary', 'Accept-Encoding');

        if (path.startsWith('/assets')) {
            context.header('Cache-Control', `public, max-age=${ONE_YEAR_IN_SECONDS}, immutable`);
        } else {
            context.header('Cache-Control', 'public, max-age=300, must-revalidate');
        }

        const acceptsBrotli = context.req.header('Accept-Encoding')?.includes('br');

        if (acceptsBrotli && asset.compressedContent) {
            context.header('Content-Encoding', 'br');
            return context.req.method === 'HEAD'
                ? context.body(null)
                : context.body(asset.compressedContent);
        }

        return context.req.method === 'HEAD'
            ? context.body(null)
            : context.body(asset.content);
    };
};