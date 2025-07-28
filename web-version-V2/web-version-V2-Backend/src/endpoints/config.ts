import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import QRCode from 'qrcode';
import sharp from 'sharp';
import {
    validateConfigRequest,
    generateConfiguration,
    type ValidatedConfigRequest,
} from '../services/configService';
import { serverCache } from '../services/serverService';

type HandlerType = 'text' | 'download' | 'qr';
type ErrorStatus = Extract<StatusCode, 404 | 500>;

interface ConfigResult {
    config: string;
    filename: string;
}

interface ConfigError {
    error: string;
    status: ErrorStatus;
}

const setNoCacheHeaders = (c: Context): void => {
    c.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
};

const getConfiguration = async (
    options: ValidatedConfigRequest
): Promise<ConfigResult | ConfigError> => {
    const { country, city, name, ...configOptions } = options;
    const allServers = await serverCache.getData();
    const server = allServers[country]?.[city]?.find((s) => s.name === name);

    if (!server) {
        return { error: 'Server not found', status: 404 };
    }

    const publicKey = serverCache.getPublicKeyById(server.keyId);
    if (!publicKey) {
        return { error: 'Server public key is not available', status: 500 };
    }

    return {
        config: generateConfiguration(server, publicKey, configOptions),
        filename: `${server.name}.conf`,
    };
};

const handleTextResponse = (c: Context, result: ConfigResult) => {
    setNoCacheHeaders(c);
    c.header('Content-Type', 'text/plain; charset=utf-8');
    return c.text(result.config);
};

const handleDownloadResponse = (c: Context, result: ConfigResult) => {
    setNoCacheHeaders(c);
    c.header('Content-Type', 'application/x-wireguard-config');
    c.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return c.body(result.config);
};

const handleQrResponse = async (c: Context, result: ConfigResult) => {
    try {
        const qrBuffer = await QRCode.toBuffer(result.config, {
            type: 'png',
            width: 256,
            margin: 1,
            errorCorrectionLevel: 'L',
        });

        const webpBuffer = await sharp(qrBuffer).webp({ quality: 90 }).toBuffer();
        setNoCacheHeaders(c);
        c.header('Content-Type', 'image/webp');
        return c.body(webpBuffer);
    } catch (error) {
        return c.json({ error: 'Failed to generate QR code' }, { status: 500 });
    }
};

export const createConfigHandler =
    (type: HandlerType) => async (c: Context) => {
        const body = await c.req.json();
        const validationResult = validateConfigRequest(body);

        if (!validationResult.success) {
            return c.json({ error: validationResult.error }, { status: 400 });
        }

        const configResult = await getConfiguration(validationResult.data);

        if ('error' in configResult) {
            return c.json(
                { error: configResult.error },
                { status: configResult.status }
            );
        }

        switch (type) {
            case 'text':
                return handleTextResponse(c, configResult);
            case 'download':
                return handleDownloadResponse(c, configResult);
            case 'qr':
                return await handleQrResponse(c, configResult);
        }
    };