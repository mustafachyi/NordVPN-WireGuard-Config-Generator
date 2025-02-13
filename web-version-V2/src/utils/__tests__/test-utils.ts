import type { GroupedServers } from "../../services/serverService";

export interface TestResponse {
  status: number;
  headers: Headers;
  body: any;
}

export interface ConfigRequest {
  country?: string;
  city?: string;
  name?: string;
  privateKey?: string;
  dns?: string;
  endpoint?: string;
  keepalive?: number;
}

export const validTestToken = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
export const invalidTestToken = "invalid_token";

export const testServers: GroupedServers = {
  "united_states": {
    "new_york": [
      {
        name: "us8675_wireguard",
        station: "station.nordvpn.com",
        hostname: "hostname.nordvpn.com",
        load: 45,
        keyId: 1
      }
    ]
  }
};

export const validConfigRequest: ConfigRequest = {
  country: "united_states",
  city: "new_york",
  name: "us8675_wireguard",
  privateKey: "base64_encoded_private_key=",
  dns: "103.86.96.100",
  endpoint: "hostname",
  keepalive: 25
};

export async function mockServerResponse(data: any) {
  return {
    data: JSON.stringify(data),
    etag: "test-etag"
  };
}

export async function makeRequest(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
) {
  try {
    const response = await fetch(`http://localhost:3000${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const contentType = response.headers.get("Content-Type");
    const responseBody = contentType?.includes("application/json")
      ? await response.json()
      : await response.text();

    return {
      status: response.status,
      headers: response.headers,
      body: responseBody
    };
  } catch (error) {
    console.error("Request failed:", error);
    throw error;
  }
} 