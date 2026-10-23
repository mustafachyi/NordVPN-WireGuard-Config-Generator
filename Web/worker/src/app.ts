import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { keyRoute } from "./routes/key";
import { serversRoute } from "./routes/servers";
import { syncRoute } from "./routes/sync";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (context, next) => {
  await next();
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");

  if (context.res.status >= 400) {
    context.header("Cache-Control", "no-store");
  }
});

app.route("/api/servers", serversRoute);
app.route("/api/key", keyRoute);
app.route("/api/sync", syncRoute);

app.notFound((context) => context.json({ error: "Not Found" }, 404));

app.onError((error, context) => {
  context.header("Cache-Control", "no-store");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");

  if (error instanceof HTTPException && error.status >= 400 && error.status < 500) {
    return context.json({ error: error.message }, error.status);
  }

  console.error({
    event: "unhandled_request_error",
    error: error instanceof Error ? error.message : String(error),
    method: context.req.method,
    path: context.req.path,
  });
  return context.json({ error: "Internal Server Error" }, 500);
});

export { app };
