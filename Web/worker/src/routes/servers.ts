import { Hono } from "hono";
import { cors } from "hono/cors";
import { SERVER_CACHE_MAX_AGE_SECONDS } from "../constants";
import { apiRateLimit } from "../middleware/rate-limit";
import { matchesIfNoneMatch } from "../services/http";
import {
  getServerCache,
  refreshServerCache,
  type ServerCacheState,
} from "../services/server-cache";

const serversRoute = new Hono<{ Bindings: Env }>();

serversRoute.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  allowHeaders: ["If-None-Match"],
  exposeHeaders: ["ETag", "Retry-After"],
  maxAge: 86_400,
}));

serversRoute.get("/", apiRateLimit("servers"), async (context) => {
  if (new URL(context.req.url).search) {
    return context.json({ error: "Query parameters are not supported" }, 400);
  }

  let state: ServerCacheState;

  try {
    state = await getServerCache(context.env)
      ?? await refreshServerCache(context.env, null);
  } catch (error) {
    console.error({
      event: "server_cache_unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
    return context.json({ error: "Server data unavailable" }, 503);
  }

  const headers = createCatalogHeaders(state.etag);
  if (matchesIfNoneMatch(context.req.header("if-none-match"), state.etag)) {
    return new Response(null, {
      status: 304,
      headers,
    });
  }

  return new Response(state.json, {
    status: 200,
    headers,
  });
});

function createCatalogHeaders(etag: string): Headers {
  return new Headers({
    "Cache-Control": [
      "public",
      `max-age=${SERVER_CACHE_MAX_AGE_SECONDS}`,
      "stale-while-revalidate=60",
      "stale-if-error=86400",
    ].join(", "),
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
  });
}

export { serversRoute };