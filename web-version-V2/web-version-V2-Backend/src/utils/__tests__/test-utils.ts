export const validTestToken = 'a'.repeat(64);

export const validConfigRequest = {
    country: 'united_states',
    city: 'new_york',
    name: 'us_newyork_1',
};

interface MakeRequestOptions {
    body?: unknown;
    key?: string;
}

export async function makeRequest(
    method: string,
    path: string,
    options: MakeRequestOptions = {}
): Promise<{ status: number; headers: Headers; body: any }> {
    const { body = null, key = null } = options;
    
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (key) {
        headers.set('X-Test-Key', key);
    }

    const response = await fetch(`http://localhost:3001${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
    });

    const contentType = response.headers.get('Content-Type') || '';
    let responseBody: any;

    if (contentType.includes('json')) {
        responseBody = await response.json().catch(() => null);
    } else if (contentType.includes('image') || contentType.includes('application')) {
        responseBody = await response.arrayBuffer();
    } else {
        responseBody = await response.text();
    }

    return {
        status: response.status,
        headers: response.headers,
        body: responseBody,
    };
}