import type { ProcessedServer } from "../../services/serverService";

export interface TestResponse {
  status: number;
  headers: Headers;
  body: any;
}

export interface ConfigRequest {
  country: string;
  city: string;
  name: string;
  privateKey?: string;
  dns?: string;
  endpoint?: 'hostname' | 'station';
  keepalive?: number;
}

export const validTestToken = "a".repeat(64);
export const invalidTestToken = "invalid";

export const testServers: Record<string, Record<string, ProcessedServer[]>> = {
  united_states: {
    new_york: [{
      name: "us8675_wireguard",
      station: "station.test.com",
      hostname: "host.test.com",
      load: 45,
      keyId: 1
    }]
  }
};

export const validConfigRequest: ConfigRequest = {
  country: "united_states",
  city: "new_york",
  name: "us8675_wireguard"
};

const mockResponses = new Map<string, any>();

export function mockServerResponse(data: unknown): void {
  mockResponses.clear();
  mockResponses.set("https://api.nordvpn.com/v1/servers", data);
}

export async function makeRequest(
  method: string,
  path: string,
  body: unknown = null,
  headers: Record<string, string> = {}
): Promise<{
  status: number;
  headers: Headers;
  body: any;
}> {
  if (method === "GET" && path === "/api/servers") {
    const mockData = mockResponses.get("https://api.nordvpn.com/v1/servers");
    if (mockData) {
      return {
        status: 200,
        headers: new Headers({
          "ETag": `"${Date.now().toString(36)}"`,
          "Content-Type": "application/json"
        }),
        body: mockData
      };
    }
  }

  const response = await fetch(`http://localhost:3001${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : null
  });

  const responseHeaders = response.headers;
  const responseBody = response.headers.get("Content-Type")?.includes("json") 
    ? await response.json().catch(() => null)
    : await response.text();

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody
  };
} 