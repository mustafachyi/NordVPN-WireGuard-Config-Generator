import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
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

keyRoute.use("*", cors({
  origin: "*",
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  exposeHeaders: ["Retry-After"],
  maxAge: 86_400,
}));

keyRoute.post(
  "/",
  async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  },
  apiRateLimit("key"),
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

export { keyRoute };