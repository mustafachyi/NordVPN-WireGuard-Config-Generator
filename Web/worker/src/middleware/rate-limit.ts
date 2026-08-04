import type { MiddlewareHandler } from "hono";
import { RATE_LIMIT_RETRY_AFTER_SECONDS } from "../constants";

type ApiRateLimiterBinding = "API_RATE_LIMITER" | "KEY_RATE_LIMITER";

export function apiRateLimit(
  binding: ApiRateLimiterBinding,
  scope: string,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (context, next) => {
    const clientIp = context.req.header("cf-connecting-ip") ?? "local";
    const { success } = await context.env[binding].limit({
      key: `${scope}:${clientIp}`,
    });

    if (!success) {
      context.header("Retry-After", String(RATE_LIMIT_RETRY_AFTER_SECONDS));
      return context.json({ error: "Rate limit exceeded" }, 429);
    }

    await next();
  };
}