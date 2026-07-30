import { app } from "./app";
import { refreshServerCache } from "./services/server-cache";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
  ): Promise<void> {
    try {
      await refreshServerCache(env);
    } catch (error) {
      console.error({
        event: "scheduled_catalog_refresh_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/api/")) {
      return await app.fetch(request, env, context);
    }

    return await env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;