import type { Context } from 'hono';

interface NordVPNResponse {
  nordlynx_private_key: string;
}

interface TokenRequest {
  token: string;
}

function validateToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token);
}

export async function handleKeyRequest(c: Context) {
  const data = await c.req.json<TokenRequest>();
  
  if (!data.token) {
    return c.json({ error: "Token required" }, 401);
  }

  if (!validateToken(data.token)) {
    return c.json({ error: "Invalid token format" }, 400);
  }

  try {
    const response = await fetch("https://api.nordvpn.com/v1/users/services/credentials", {
      headers: { "Authorization": `token:${data.token}` }
    });

    const status = response.status;
    
    switch (status) {
      case 200:
        const data = await response.json() as NordVPNResponse;
        return c.json({ key: data.nordlynx_private_key });
      case 401:
        return c.json({ error: "Invalid token" }, 401);
      default:
        return c.json({ error: "Service unavailable" }, 503);
    }

  } catch {
    return c.json({ error: "Service unavailable" }, 503);
  }
}
