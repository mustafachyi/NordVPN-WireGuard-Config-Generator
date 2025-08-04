import type { Context } from 'hono';
import QRCode from 'qrcode';
import {
    validateConfigRequest,
    generateConfiguration,
    type ValidatedConfig,
} from '../services/configService';
import { serverCache } from '../services/serverService';

type HandlerType = 'text' | 'download' | 'qr';
type ConfigErrorStatus = 404 | 500;

interface ConfigData {
    configText: string;
    fileName: string;
}

const setNoCacheHeaders = (context: Context): void => {
    context.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
};

async function createConfig(options: ValidatedConfig): Promise<{ data?: ConfigData; error?: { message: string; status: ConfigErrorStatus } }> {
    const { country, city, name, ...configOptions } = options;
    const allServers = await serverCache.getServers();
    const server = allServers[country]?.[city]?.find((s) => s.name === name);

    if (!server) {
        return { error: { message: 'The requested server could not be found.', status: 404 } };
    }

    const publicKey = serverCache.getPublicKey(server.keyId);
    if (!publicKey) {
        return { error: { message: 'Server public key is not available.', status: 500 } };
    }

    const configText = generateConfiguration(server, publicKey, configOptions);
    return { data: { configText, fileName: `${server.name}.conf` } };
}

const respondAsText = (context: Context, data: ConfigData) => {
    setNoCacheHeaders(context);
    context.header('Content-Type', 'text/plain; charset=utf-8');
    return context.text(data.configText);
};

const respondAsDownload = (context: Context, data: ConfigData) => {
    setNoCacheHeaders(context);
    context.header('Content-Type', 'application/x-wireguard-config');
    context.header('Content-Disposition', `attachment; filename="${data.fileName}"`);
    return context.body(data.configText);
};

const respondAsQrCode = async (context: Context, data: ConfigData) => {
    try {
        const qrPngBuffer = await QRCode.toBuffer(data.configText, {
            width: 256,
            margin: 1,
            errorCorrectionLevel: 'L',
        });
        setNoCacheHeaders(context);
        context.header('Content-Type', 'image/png');
        return context.body(qrPngBuffer);
    } catch (error) {
        return context.json({ error: 'Failed to generate QR code image.' }, { status: 500 });
    }
};

export const createConfigHandler = (type: HandlerType) => async (context: Context) => {
    const body = await context.req.json().catch(() => ({}));
    const validation = validateConfigRequest(body);

    if (!validation.success) {
        return context.json({ error: validation.error }, { status: 400 });
    }

    const result = await createConfig(validation.data);

    if (result.error) {
        return context.json({ error: result.error.message }, { status: result.error.status });
    }
    
    if (!result.data) {
        return context.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    switch (type) {
        case 'text':
            return respondAsText(context, result.data);
        case 'download':
            return respondAsDownload(context, result.data);
        case 'qr':
            return await respondAsQrCode(context, result.data);
    }
};