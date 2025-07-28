import type { Context } from 'hono';
import { exchangeTokenForKey } from '../services/keyService.ts';

export async function handleKeyRequest(c: Context) {
    const { token } = await c.req.json<{ token?: string }>();

    if (!token) {
        return c.json({ error: 'Token is required' }, { status: 400 });
    }

    const result = await exchangeTokenForKey(token);

    if (!result.success) {
        return c.json({ error: result.error }, { status: result.status });
    }

    return c.json({ key: result.key });
}