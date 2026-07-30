import { Hono } from "hono";
import {
  getBearerToken,
  secretsMatch,
} from "../services/http";
import { refreshServerCache } from "../services/server-cache";

const syncRoute = new Hono<{ Bindings: Env }>();

syncRoute.post("/", async (context) => {
  context.header("Cache-Control", "no-store");

  const providedToken = getBearerToken(context.req.header("authorization"));
  if (!providedToken || !await secretsMatch(providedToken, context.env.SYNC_TOKEN)) {
    return context.json({ error: "Unauthorized" }, 401);
  }

  try {
    await refreshServerCache(context.env);
    return context.json({ success: true }, 200);
  } catch (error) {
    console.error({
      event: "manual_synchronization_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return context.json({ error: "Synchronization failed" }, 502);
  }
});

export { syncRoute };