import type { StatusCode } from 'hono/utils/http-status';

const NORDVPN_API_URL = 'https://api.nordvpn.com/v1/users/services/credentials';
const TOKEN_HEX_PATTERN = /^[a-f0-9]{64}$/i;

type ErrorStatus = Extract<StatusCode, 400 | 401 | 503>;

type KeyExchangeResult =
    | { success: true; key: string }
    | { success: false; error: string; status: ErrorStatus };

export async function exchangeTokenForKey(token: string): Promise<KeyExchangeResult> {
    if (!TOKEN_HEX_PATTERN.test(token)) {
        return { success: false, error: 'Invalid token format.', status: 400 };
    }

    try {
        const response = await fetch(NORDVPN_API_URL, {
            headers: { Authorization: `Bearer token:${token}` },
        });

        if (response.status === 200) {
            const data = (await response.json()) as { nordlynx_private_key: string };
            return { success: true, key: data.nordlynx_private_key };
        }

        if (response.status === 401) {
            return { success: false, error: 'Token is invalid or has expired.', status: 401 };
        }

        return {
            success: false,
            error: 'Authentication service rejected the request.',
            status: 503,
        };
    } catch (error) {
        return {
            success: false,
            error: 'Authentication service is unreachable.',
            status: 503,
        };
    }
}