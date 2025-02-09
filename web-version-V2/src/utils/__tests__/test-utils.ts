import type { Mock } from "bun:test";

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

export async function makeRequest(
  method: string,
  path: string,
  body?: any,
  headers?: HeadersInit
): Promise<TestResponse> {
  const url = new URL(path, "http://localhost:3000");
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: responseBody,
  };
}

export function mockServerResponse(data: any = {}, etag: string = "test-etag") {
  return {
    data: JSON.stringify(data),
    etag,
  };
}

export const validTestToken = "a".repeat(64);
export const invalidTestToken = "invalid_token";

export const testServers = {
  united_states: {
    new_york: [
      {
        name: "us8675_wireguard",
        load: 45,
      },
    ],
    miami: [
      {
        name: "us1234_wireguard",
        load: 30,
      },
    ],
  },
};

export const validConfigRequest: ConfigRequest = {
  country: "united_states",
  city: "new_york",
  name: "us8675_wireguard",
  privateKey: "base64_encoded_private_key=",
  dns: "103.86.96.100",
  endpoint: "hostname",
  keepalive: 25,
}; 