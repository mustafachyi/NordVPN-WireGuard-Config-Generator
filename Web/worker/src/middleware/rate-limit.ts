import type { MiddlewareHandler } from "hono";
import { RATE_LIMIT_RETRY_AFTER_SECONDS } from "../constants";

export function apiRateLimit(scope: string): MiddlewareHandler<{ Bindings: Env }> {
  return async (context, next) => {
    const clientIp = context.req.header("cf-connecting-ip") ?? "local";
    const { success } = await context.env.API_RATE_LIMITER.limit({
      key: `${scope}:${clientIp}`,
    });

    if (!success) {
      context.header("Retry-After", String(RATE_LIMIT_RETRY_AFTER_SECONDS));
      return context.json({ error: "Rate limit exceeded" }, 429);
    }

    await next();
  };
}