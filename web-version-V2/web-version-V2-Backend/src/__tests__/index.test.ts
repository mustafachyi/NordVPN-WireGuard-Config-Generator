import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test';
import { serve } from 'bun';
import { app, initializeCacheManager } from '../../index';
import { makeRequest, validTestToken, validConfigRequest } from '../utils/__tests__/test-utils';

mock.module('qrcode', () => ({
    default: {
        toBuffer: mock(() => Promise.resolve(Buffer.from('mock_qr_code_buffer'))),
    },
}));

mock.module('sharp', () => ({
    default: () => ({
        webp: () => ({
            toBuffer: () => Promise.resolve(Buffer.from('mock_webp_buffer')),
        }),
    }),
}));

const TEST_PORT = 3001;

describe('API Integration Tests', () => {
    let server: ReturnType<typeof serve>;
    const originalFetch = global.fetch;

    beforeAll(async () => {
        const fetchMock = mock(async (resource: URL | Request | string, options?: RequestInit) => {
            const url = resource.toString();
            if (url.startsWith(`http://localhost:${TEST_PORT}`)) {
                return originalFetch(resource, options);
            }
            if (url.includes('credentials')) {
                const token = (options?.headers as Record<string, string>)['Authorization']?.split(':')[1];
                return token === validTestToken
                    ? new Response(JSON.stringify({ nordlynx_private_key: 'valid_private_key=' }), { status: 200 })
                    : new Response(null, { status: 401 });
            }
            if (url.includes('servers')) {
                const mockData = [{
                    name: 'us_newyork_1', station: 'us-ny.nord.com', hostname: 'us-ny.nord.com', load: 10,
                    locations: [{ country: { name: 'United States', city: { name: 'New York' } } }],
                    technologies: [{ metadata: [{ name: 'public_key', value: 'server_public_key=' }] }]
                }];
                return new Response(JSON.stringify(mockData), { status: 200 });
            }
            return new Response('Mocked fetch error', { status: 500 });
        });
        
        global.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });

        await initializeCacheManager();
        server = serve({ port: TEST_PORT, fetch: app.fetch });
    });

    afterAll(() => {
        server.stop(true);
        global.fetch = originalFetch;
    });

    test('GET /api/servers should return server list', async () => {
        const res = await makeRequest('GET', '/api/servers');
        expect(res.status).toBe(200);
        expect(res.body.united_states.new_york[0].name).toBe('us_newyork_1');
        expect(res.headers.get('etag')).toBeDefined();
    });

    test('POST /api/key should succeed with a valid token', async () => {
        const res = await makeRequest('POST', '/api/key', { body: { token: validTestToken } });
        expect(res.status).toBe(200);
        expect(res.body.key).toBe('valid_private_key=');
    });

    test('POST /api/key should fail with an invalid token', async () => {
        const res = await makeRequest('POST', '/api/key', { body: { token: 'invalid' } });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid token format');
    });

    test('POST /api/config should return a text config', async () => {
        const res = await makeRequest('POST', '/api/config', {
            body: {
                ...validConfigRequest,
                name: "us_newyork_1"
            }
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/plain');
        expect(res.body).toContain('PublicKey=server_public_key=');
    });

    test('POST /api/config/download should return a file', async () => {
        const res = await makeRequest('POST', '/api/config/download', {
            body: {
                ...validConfigRequest,
                name: "us_newyork_1"
            }
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="us_newyork_1.conf"');
    });

    test('POST /api/config/qr should return a webp image', async () => {
        const res = await makeRequest('POST', '/api/config/qr', {
            body: {
                ...validConfigRequest,
                name: "us_newyork_1"
            }
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/webp');
        expect(res.body instanceof ArrayBuffer).toBe(true);
    });

    test('POST /api/config should fail with missing fields', async () => {
        const res = await makeRequest('POST', '/api/config', { body: { country: 'test' } });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('city');
    });

    test('POST /api/config should fail with invalid keepalive', async () => {
        const res = await makeRequest('POST', '/api/config', { body: { ...validConfigRequest, name: "us_newyork_1", keepalive: 999 } });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid keepalive: must be a number between 15 and 120.');
    });

    test('POST /api/key should be rate limited after 100 requests', async () => {
        const RATE_LIMIT = 100;
        const requests = [];
        const testKey = 'rate-limit-test-key';

        for (let i = 0; i < RATE_LIMIT; i++) {
            requests.push(makeRequest('POST', '/api/key', { body: { token: validTestToken }, key: testKey }));
        }

        const responses = await Promise.all(requests);
        for (const res of responses) {
            expect(res.status).not.toBe(429);
        }

        const rateLimitedRes = await makeRequest('POST', '/api/key', { body: { token: validTestToken }, key: testKey });
        
        expect(rateLimitedRes.status).toBe(429);
        expect(rateLimitedRes.body).toBe('Too many requests, please try again later.');
        expect(rateLimitedRes.headers.get('Retry-After')).toBeDefined();
    }, 10000);
});