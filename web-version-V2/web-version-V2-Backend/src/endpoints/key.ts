import type { Context } from 'hono';
import { exchangeTokenForKey } from '../services/keyService';

export async function handleKeyRequest(context: Context) {
    const body: { token?: unknown } = await context.req.json().catch(() => ({}));

    if (typeof body.token !== 'string' || body.token.length === 0) {
        return context.json({ error: 'Token is required in the request body.' }, { status: 400 });
    }

    const result = await exchangeTokenForKey(body.token);

    if (!result.success) {
        return context.json({ error: result.error }, { status: result.status });
    }

    return context.json({ key: result.key });
}