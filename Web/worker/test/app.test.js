import { afterEach, expect, test } from "bun:test";
import { app } from "../src/app.ts";

const originalFetch = globalThis.fetch;
const originalError = console.error;
const headers = {
  "Content-Type": "application/json",
  Origin: "https://app.test",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

test("malformed request JSON preserves its client-error status and security headers", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    throw new Error("unexpected upstream request");
  };
  const env = { KEY_RATE_LIMITER: { limit: async () => ({ success: true }) } };

  for (const body of ["{", "", "null", "[]"]) {
    const response = await app.request("https://app.test/api/key", { method: "POST", headers, body }, env);
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  }
  expect(upstreamCalls).toBe(0);
});

test("unexpected failures keep a generic server-error response", async () => {
  console.error = () => {};
  const env = { KEY_RATE_LIMITER: { limit: async () => { throw new Error("dependency failed"); } } };
  const response = await app.request("https://app.test/api/key", { method: "POST", headers, body: "{}" }, env);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Internal Server Error" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
