import { afterEach, expect, test } from "bun:test";
import { fetchWithTimeout, readResponseText } from "../src/services/http.ts";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

function createRequest() {
  let finishBody;
  let timeout;
  let timeoutCleared = false;

  globalThis.setTimeout = (callback, delay) => {
    expect(delay).toBe(15_000);
    timeout = callback;
    return 1;
  };
  globalThis.clearTimeout = () => { timeoutCleared = true; };
  globalThis.fetch = async (_input, options) => new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      finishBody = text => {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      };
    },
  }));

  return {
    finish: text => finishBody(text),
    expire: () => timeout(),
    get cleared() { return timeoutCleared; },
  };
}

test("timeout remains active until the bounded response body is consumed", async () => {
  const request = createRequest();
  const result = fetchWithTimeout("https://example.test", {}, 15_000, response => readResponseText(response, 8));
  await Promise.resolve();
  await Promise.resolve();
  expect(request.cleared).toBe(false);
  request.finish("catalog");
  expect(await result).toBe("catalog");
  expect(request.cleared).toBe(true);
});

test("stalled response body is aborted and the timer is released", async () => {
  const request = createRequest();
  const result = fetchWithTimeout("https://example.test", {}, 15_000, response => readResponseText(response, 8));
  await Promise.resolve();
  await Promise.resolve();
  expect(request.cleared).toBe(false);
  request.expire();
  await expect(result).rejects.toHaveProperty("name", "AbortError");
  expect(request.cleared).toBe(true);
});

test("oversized streamed responses are cancelled and unlocked", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("oversized"));
    },
    cancel() { cancelled = true; },
  }));
  await expect(readResponseText(response, 8)).rejects.toThrow("Response body exceeds the configured limit");
  expect(cancelled).toBe(true);
  expect(response.body.locked).toBe(false);
});

test("the exact response limit is accepted", async () => {
  const response = new Response("12345678");
  expect(await readResponseText(response, 8)).toBe("12345678");
  expect(response.body.locked).toBe(false);
});

test("declared oversized responses are cancelled before reading", async () => {
  const response = new Response("catalog", { headers: { "Content-Length": "9" } });
  await expect(readResponseText(response, 8)).rejects.toThrow("Response body exceeds the configured limit");
  expect(response.bodyUsed).toBe(true);
});

test("network errors propagate and release the timer", async () => {
  const request = createRequest();
  globalThis.fetch = async () => { throw new Error("network failure"); };
  await expect(fetchWithTimeout("https://example.test", {}, 15_000, response => response.text())).rejects.toThrow("network failure");
  expect(request.cleared).toBe(true);
});
