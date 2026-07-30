import {
  SERVER_CACHE_KEY,
  SERVER_SOURCE_MAX_BYTES,
  UPSTREAM_TIMEOUT_MS,
} from "../constants";
import { serverPayloadSchema } from "../validation/schemas";
import {
  fetchWithTimeout,
  readResponseText,
} from "./http";

interface ServerCacheMetadata {
  etag?: string;
  sourceEtag?: string;
  version?: string;
}

export interface ServerCacheState {
  etag: string;
  sourceEtag: string | null;
  json: string;
}

export async function getServerCache(env: Env): Promise<ServerCacheState | null> {
  const result = await env.NORDGEN_KV.getWithMetadata<ServerCacheMetadata>(SERVER_CACHE_KEY);
  if (!result.value) {
    return null;
  }

  const etag = normalizeEtag(result.metadata?.etag ?? result.metadata?.version);
  if (!etag) {
    return null;
  }

  return {
    etag,
    sourceEtag: normalizeEtag(result.metadata?.sourceEtag),
    json: result.value,
  };
}

export async function refreshServerCache(
  env: Env,
  currentState?: ServerCacheState | null,
): Promise<ServerCacheState> {
  const previousState = currentState === undefined
    ? await getServerCache(env)
    : currentState;

  const headers = new Headers({
    Accept: "application/json",
  });
  const sourceValidator = previousState?.sourceEtag ?? previousState?.etag;
  if (sourceValidator) {
    headers.set("If-None-Match", sourceValidator);
  }

  const response = await fetchWithTimeout(
    env.SERVER_SOURCE_URL,
    { headers },
    UPSTREAM_TIMEOUT_MS,
  );

  if (response.status === 304) {
    if (previousState) {
      return previousState;
    }
    throw new Error("Server source returned 304 without a cached catalog");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Server source returned HTTP ${response.status}`);
  }

  const json = await readResponseText(response, SERVER_SOURCE_MAX_BYTES);
  validateServerPayload(json);

  const state: ServerCacheState = {
    etag: await createContentEtag(json),
    sourceEtag: normalizeEtag(response.headers.get("etag")),
    json,
  };

  if (
    previousState
    && previousState.etag === state.etag
    && previousState.sourceEtag === state.sourceEtag
  ) {
    return previousState;
  }

  const metadata: ServerCacheMetadata = {
    etag: state.etag,
  };
  if (state.sourceEtag) {
    metadata.sourceEtag = state.sourceEtag;
  }

  await env.NORDGEN_KV.put(SERVER_CACHE_KEY, state.json, { metadata });
  return state;
}

function validateServerPayload(json: string): void {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Server source returned invalid JSON");
  }

  const result = serverPayloadSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Server source returned an invalid payload");
  }
}

async function createContentEtag(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const token = btoa(
    String.fromCharCode(...new Uint8Array(digest)),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

  return `W/"sha256-${token}"`;
}

function normalizeEtag(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (/^(?:W\/)?"[^"\\]*"$/.test(trimmed)) {
    return trimmed;
  }

  const token = trimmed.replace(/["\\]/g, "");
  return token ? `"${token}"` : null;
}