import type { StatusCode } from 'hono/utils/http-status';

const TOKEN_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const NORDVPN_API_URL = 'https://api.nordvpn.com/v1/users/services/credentials';

type ErrorStatus = Extract<StatusCode, 400 | 401 | 503>;

type KeyResult =
    | { success: true; key: string }
    | { success: false; error: string; status: ErrorStatus };

export async function exchangeTokenForKey(token: string): Promise<KeyResult> {
    if (!TOKEN_HEX_PATTERN.test(token)) {
        return {
            success: false,
            error: 'Invalid token format',
            status: 400,
        };
    }

    try {
        const response = await fetch(NORDVPN_API_URL, {
            headers: {
                Authorization: `token:${token}`,
            },
        });

        if (response.status === 200) {
            const data = (await response.json()) as { nordlynx_private_key: string };
            return { success: true, key: data.nordlynx_private_key };
        }

        if (response.status === 401) {
            return { success: false, error: 'Invalid or expired token', status: 401 };
        }

        return {
            success: false,
            error: 'Failed to communicate with authentication service',
            status: 503,
        };
    } catch (error) {
        return {
            success: false,
            error: 'Service unavailable',
            status: 503,
        };
    }
}