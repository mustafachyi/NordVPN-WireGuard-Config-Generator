import type { Context } from 'hono';
import { serverCache } from '../services/serverService';
import { generateConfig, type ConfigOptions, CONFIG_VALIDATION } from '../services/configService';
import QRCode from 'qrcode';
import sharp from 'sharp';

// Types
interface ServerSelection {
  country: string;
  city: string;
  name: string;
}

interface ConfigRequest extends Omit<ConfigOptions, 'useStation'>, ServerSelection {
  endpoint?: 'hostname' | 'station';
}

// Constants
const QR_CONFIG = {
  type: 'png',
  width: 200,
  margin: 1,
  errorCorrectionLevel: 'L'
} as const;

const RESPONSE_HEADERS = {
  WIREGUARD_CONFIG: {
    'Content-Type': 'application/x-wireguard-config',
    'Cache-Control': 'private, no-cache, no-store, must-revalidate'
  },
  PLAIN_TEXT: {
    'Content-Type': 'text/plain; charset=utf-8'
  },
  WEBP: {
    'Content-Type': 'image/webp'
  }
} as const;

// Helper functions
const validateConfig = async (data: ConfigRequest): Promise<string | null> => {
  if (!data.country || !data.city || !data.name) {
    return "Missing required fields";
  }
  
  if (data.privateKey && !CONFIG_VALIDATION.privateKey(data.privateKey)) {
    return "Invalid private key format";
  }
  
  if (data.dns && !CONFIG_VALIDATION.dns(data.dns)) {
    return "Invalid DNS format";
  }
  
  if (data.keepalive !== undefined && !CONFIG_VALIDATION.keepalive(data.keepalive)) {
    return "Invalid keepalive value (15-120)";
  }

  if (data.endpoint && !['hostname', 'station'].includes(data.endpoint)) {
    return "Invalid endpoint value";
  }
  
  return null;
};

const createConfigOptions = (data: ConfigRequest): ConfigOptions => ({
  privateKey: data.privateKey,
  dns: data.dns,
  useStation: data.endpoint === 'station',
  keepalive: data.keepalive
});

const getServerConfig = async (
  selection: ServerSelection, 
  options: ConfigOptions
): Promise<{ config: string; filename: string; } | null> => {
  const servers = await serverCache.getData();
  const serverList = servers[selection.country]?.[selection.city];
  if (!serverList) return null;

  const server = serverList.find(s => s.name === selection.name);
  if (!server) return null;

  const publicKey = serverCache.getPublicKeyById(server.keyId);
  if (!publicKey) return null;

  return {
    config: generateConfig(server, publicKey, options),
    filename: `${server.name}.conf`
  };
};

// Request handlers
export async function handleConfigRequest(c: Context) {
  const data = await c.req.json<ConfigRequest>();
  
  const error = await validateConfig(data);
  if (error) return c.json({ error }, 400);

  const result = await getServerConfig(
    { country: data.country, city: data.city, name: data.name },
    createConfigOptions(data)
  );

  if (!result) return c.json({ error: "Server not found" }, 404);

  return new Response(result.config, { headers: RESPONSE_HEADERS.PLAIN_TEXT });
}

export async function handleConfigQrRequest(c: Context) {
  const data = await c.req.json<ConfigRequest>();
  
  const error = await validateConfig(data);
  if (error) return c.json({ error }, 400);

  const result = await getServerConfig(
    { country: data.country, city: data.city, name: data.name },
    createConfigOptions(data)
  );

  if (!result) return c.json({ error: "Server not found" }, 404);
  
  try {
    const qrBuffer = await QRCode.toBuffer(result.config, QR_CONFIG);
    const webpBuffer = await sharp(qrBuffer)
      .webp({ nearLossless: true })
      .toBuffer();
    
    return new Response(webpBuffer, {
      headers: {
        ...RESPONSE_HEADERS.WEBP,
        'Content-Length': webpBuffer.length.toString()
      }
    });
  } catch {
    return c.json({ error: "Failed to generate QR code" }, 500);
  }
}

export async function handleConfigDownloadRequest(c: Context) {
  const data = await c.req.json<ConfigRequest>();
  
  const error = await validateConfig(data);
  if (error) return c.json({ error }, 400);

  const result = await getServerConfig(
    { country: data.country, city: data.city, name: data.name },
    createConfigOptions(data)
  );

  if (!result) return c.json({ error: "Server not found" }, 404);

  return new Response(result.config, {
    headers: {
      ...RESPONSE_HEADERS.WIREGUARD_CONFIG,
      'Content-Disposition': `attachment; filename="${result.filename}"`
    }
  });
}
