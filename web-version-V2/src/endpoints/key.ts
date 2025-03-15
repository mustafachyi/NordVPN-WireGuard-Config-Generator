import type { Context } from 'hono';

// Types
interface TokenRequest {
  token: string;
}

interface NordVPNResponse {
  nordlynx_private_key: string;
}

// Constants
const TOKEN_CONFIG = {
  PATTERN: /^[a-f0-9]{64}$/i,
  AUTH_PREFIX: 'token:',
  API_URL: 'https://api.nordvpn.com/v1/users/services/credentials'
} as const;

const RESPONSE_ERRORS = {
  MISSING_TOKEN: { error: "Token required" },
  INVALID_FORMAT: { error: "Invalid token format" },
  INVALID_TOKEN: { error: "Invalid token" },
  SERVICE_ERROR: { error: "Service unavailable" }
} as const;

/**
 * Validates token format
 */
const isValidToken = (token: string): boolean => 
  TOKEN_CONFIG.PATTERN.test(token);

/**
 * Handles private key generation requests
 */
export async function handleKeyRequest(c: Context) {
  const data = await c.req.json<TokenRequest>();
  
  if (!data.token) {
    return c.json(RESPONSE_ERRORS.MISSING_TOKEN, 401);
  }

  if (!isValidToken(data.token)) {
    return c.json(RESPONSE_ERRORS.INVALID_FORMAT, 400);
  }

  try {
    const response = await fetch(TOKEN_CONFIG.API_URL, {
      headers: { 
        "Authorization": `${TOKEN_CONFIG.AUTH_PREFIX}${data.token}` 
      }
    });

    switch (response.status) {
      case 200: {
        const { nordlynx_private_key } = await response.json() as NordVPNResponse;
        return c.json({ key: nordlynx_private_key });
      }
      case 401:
        return c.json(RESPONSE_ERRORS.INVALID_TOKEN, 401);
      default:
        return c.json(RESPONSE_ERRORS.SERVICE_ERROR, 503);
    }
  } catch {
    return c.json(RESPONSE_ERRORS.SERVICE_ERROR, 503);
  }
}
