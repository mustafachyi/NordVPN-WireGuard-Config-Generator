import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  CREDENTIAL_RESPONSE_MAX_BYTES,
  REQUEST_BODY_LIMIT_BYTES,
  UPSTREAM_TIMEOUT_MS,
} from "../constants";
import { apiRateLimit } from "../middleware/rate-limit";
import {
  fetchWithTimeout,
  readResponseText,
} from "../services/http";
import {
  keyValidator,
  nordVpnCredentialsSchema,
} from "../validation/schemas";

const keyRoute = new Hono<{ Bindings: Env }>();

const sameOriginBrowserOnly: MiddlewareHandler<{ Bindings: Env }> = async (
  context,
  next,
) => {
  if (!isSameOriginBrowserRequest(context.req.raw)) {
    return context.json({ error: "Forbidden" }, 403);
  }

  await next();
};

keyRoute.use("*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
});

keyRoute.post(
  "/",
  apiRateLimit("KEY_RATE_LIMITER", "key"),
  sameOriginBrowserOnly,
  bodyLimit({
    maxSize: REQUEST_BODY_LIMIT_BYTES,
    onError: (context) => context.json({ error: "Request body too large" }, 413),
  }),
  keyValidator(),
  async (context) => {
    const body = context.req.valid("json");

    let upstream: Response;

    try {
      upstream = await fetchWithTimeout(
        context.env.NORDVPN_CREDENTIALS_URL,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer token:${body.token}`,
          },
        },
        UPSTREAM_TIMEOUT_MS,
      );
    } catch (error) {
      console.error({
        event: "credential_request_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return context.json({ error: "Upstream unavailable" }, 503);
    }

    if (upstream.status === 401) {
      await upstream.body?.cancel();
      return context.json({ error: "Expired token" }, 401);
    }

    if (!upstream.ok) {
      await upstream.body?.cancel();
      return context.json({ error: "Upstream error" }, 503);
    }

    let value: unknown;

    try {
      value = JSON.parse(
        await readResponseText(upstream, CREDENTIAL_RESPONSE_MAX_BYTES),
      );
    } catch {
      return context.json({ error: "Invalid upstream response" }, 503);
    }

    const result = nordVpnCredentialsSchema.safeParse(value);
    if (!result.success) {
      return context.json({ error: "Invalid upstream response" }, 503);
    }

    return context.json({ key: result.data.nordlynx_private_key }, 200);
  },
);

function isSameOriginBrowserRequest(request: Request): boolean {
  const fetchMode = request.headers.get("sec-fetch-mode");

  return request.headers.get("origin") === new URL(request.url).origin
    && request.headers.get("sec-fetch-site") === "same-origin"
    && (fetchMode === "cors" || fetchMode === "same-origin")
    && request.headers.get("sec-fetch-dest") === "empty";
}

export { keyRoute };