import type { Context } from 'hono';
import { serverCache } from '../services/serverService';
import { generateConfig, type ConfigOptions, CONFIG_VALIDATION } from '../services/configService';
import QRCode from 'qrcode';
import sharp from 'sharp';

interface BaseConfigRequest {
  privateKey?: string;
  dns?: string;
  endpoint?: 'hostname' | 'station';
  keepalive?: number;
}

interface ServerSelection {
  country: string;
  city: string;
  name: string;
}

interface ConfigRequest extends BaseConfigRequest, ServerSelection {}

async function validateConfigRequest(data: BaseConfigRequest): Promise<string | null> {
  if (data.privateKey && !CONFIG_VALIDATION.privateKey(data.privateKey)) {
    return "Invalid private key format";
  }
  if (data.dns && !CONFIG_VALIDATION.dns(data.dns)) {
    return "Invalid DNS format";
  }
  if (data.keepalive !== undefined && !CONFIG_VALIDATION.keepalive(data.keepalive)) {
    return "Invalid keepalive value. Must be between 15 and 120";
  }
  return null;
}

async function getServerConfig(selection: ServerSelection, options: ConfigOptions): Promise<{ config: string; filename: string; } | null> {
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
}

export async function handleConfigRequest(c: Context) {
  const data = await c.req.json<ConfigRequest>();
  
  const error = await validateConfigRequest(data);
  if (error) {
    return c.json({ error }, 400);
  }

  const result = await getServerConfig(
    { country: data.country, city: data.city, name: data.name },
    {
      privateKey: data.privateKey,
      dns: data.dns,
      useStation: data.endpoint === 'station',
      keepalive: data.keepalive
    }
  );

  if (!result) {
    return c.json({ error: "Server not found" }, 404);
  }

  return new Response(result.config, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}

export async function handleConfigQrRequest(c: Context) {
  const data = await c.req.json<ConfigRequest>();
  
  const error = await validateConfigRequest(data);
  if (error) {
    return c.json({ error }, 400);
  }

  const result = await getServerConfig(
    { country: data.country, city: data.city, name: data.name },
    {
      privateKey: data.privateKey,
      dns: data.dns,
      useStation: data.endpoint === 'station',
      keepalive: data.keepalive
    }
  );

  if (!result) {
    return c.json({ error: "Server not found" }, 404);
  }
  
  try {
    const qrBuffer = await QRCode.toBuffer(result.config, {
      type: 'png',
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'L'
    });
    
    const webpBuffer = await sharp(qrBuffer)
      .webp({ nearLossless: true })
      .toBuffer();
    
    return new Response(webpBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': webpBuffer.length.toString()
      }
    });
  } catch {
    return c.json({ error: "Failed to generate QR code" }, 500);
  }
}

export async function handleConfigDownloadRequest(c: Context) {
  const data = await c.req.json<ConfigRequest>();
  
  const error = await validateConfigRequest(data);
  if (error) {
    return c.json({ error }, 400);
  }

  const result = await getServerConfig(
    { country: data.country, city: data.city, name: data.name },
    {
      privateKey: data.privateKey,
      dns: data.dns,
      useStation: data.endpoint === 'station',
      keepalive: data.keepalive
    }
  );

  if (!result) {
    return c.json({ error: "Server not found" }, 404);
  }

  return new Response(result.config, {
    headers: {
      'Content-Type': 'application/x-wireguard-config',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate'
    }
  });
}
