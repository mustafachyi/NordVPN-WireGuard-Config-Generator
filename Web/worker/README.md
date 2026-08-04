# NordGen Worker

NordGen Worker serves the browser application and provides the API used by its
server catalogue and private-key generator.

The browser creates configuration files, ZIP archives, and QR codes locally.
The Worker handles server data, credential exchange, and catalogue
synchronization.

## Responsibilities

The deployment is divided into four parts:

| Component         | Responsibility                                  |
| ----------------- | ----------------------------------------------- |
| Static Assets     | Serves the compiled Vue application             |
| Hono Worker       | Handles `/api/*` requests                       |
| Cloudflare KV     | Stores the latest validated server catalogue    |
| Cloudflare Cache  | Caches catalogue responses close to clients     |

A scheduled task refreshes the catalogue every five minutes.

## Request Flow

Requests under `/api/` are passed to the Hono application.

Other requests are served through the `ASSETS` binding.

The API contains three routes:

| Route          | Purpose                                      |
| -------------- | -------------------------------------------- |
| `/api/servers` | Returns the processed server catalogue       |
| `/api/key`     | Exchanges an access token for a private key  |
| `/api/sync`    | Performs an authenticated catalogue refresh  |

Detailed request and response formats are documented in
[`api.md`](./api.md).

## Cloudflare Bindings

`worker/wrangler.jsonc` defines the following bindings and variables:

| Name                      | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `NORDGEN_KV`              | Stores the validated catalogue and ETag metadata  |
| `API_RATE_LIMITER`        | Limits catalogue requests reaching the Worker     |
| `KEY_RATE_LIMITER`        | Limits private-key exchange requests               |
| `ASSETS`                  | Serves the compiled frontend                       |
| `SERVER_SOURCE_URL`       | Provides the packed server catalogue               |
| `NORDVPN_CREDENTIALS_URL` | Exchanges NordVPN access tokens                    |
| `SYNC_TOKEN`              | Protects manual catalogue synchronization          |

The rate-limit bindings use separate namespaces and policies:

| Binding              | Policy                     |
| -------------------- | -------------------------- |
| `API_RATE_LIMITER`   | 100 requests per 60 seconds |
| `KEY_RATE_LIMITER`   | 10 requests per 60 seconds  |

The configuration also defines:

- The production custom domain.
- The five-minute cron trigger.
- Workers Cache support.
- Static-asset routing.
- Observability.

The namespace identifiers, custom domain, source URL, and route configuration
are specific to this deployment. Forks must replace them before deployment.

Every rate-limit namespace identifier must be unique among independent
rate-limit policies in the Cloudflare account.

## Prerequisites

- Bun 1.3.14
- A Cloudflare account for production deployment
- A Workers KV namespace
- Two Workers Rate Limiting bindings
- A compatible server-catalogue source
- A synchronization secret

## Local Setup

Run all commands in this section from the `Web` directory.

Install dependencies:

```cmd
bun install
```

Create `worker/.dev.vars` from `worker/.dev.vars.example`.

The local file must contain:

```dotenv
SYNC_TOKEN=replace-with-a-random-secret
```

Do not commit `worker/.dev.vars`.

Start the frontend and Worker development environment:

```cmd
bun run dev
```

The Cloudflare Vite plugin starts both parts through the frontend Vite
configuration.

## Verification

Generate the Worker binding types, run TypeScript checking, and build the
frontend:

```cmd
bun run check
```

Audit installed dependencies:

```cmd
bun audit
```

`bun run check` performs the following sequence:

```text
wrangler types
TypeScript type checking
Vite production build
```

It does not run `bun audit`.

After changing rate-limit bindings, the generated
`worker/worker-configuration.d.ts` must include both:

```text
API_RATE_LIMITER
KEY_RATE_LIMITER
```

The generated file is ignored by Git.

## Production Secret

Create the synchronization secret before deployment:

```cmd
bunx wrangler secret put SYNC_TOKEN --config worker\wrangler.jsonc
```

The secret value is stored by Cloudflare and is not written into
`wrangler.jsonc`.

## Deployment

Deploy from the `Web` directory:

```cmd
bun run deploy
```

The deployment script:

1. Generates Worker binding types.
2. Runs TypeScript checking.
3. Builds the frontend.
4. Uploads the static assets.
5. Deploys the Worker.

Dependency auditing remains a separate command.

## Catalogue Storage

The latest validated catalogue is stored in KV with:

- A content-derived ETag.
- The source ETag when one is available.
- The exact validated JSON response.

During refresh, the Worker sends the previous source validator through
`If-None-Match`.

A `304 Not Modified` source response keeps the current catalogue.

A changed response is validated before KV is updated.

A failed scheduled refresh is logged and does not delete the existing KV
value.

KV does not currently store or enforce a maximum catalogue age. This preserves
availability during extended source failures, but it also permits an older
last-known-good catalogue to remain available indefinitely.

## Cache Behavior

Successful catalogue responses provide:

```http
Cache-Control: public, max-age=300, stale-while-revalidate=60, stale-if-error=86400
```

Cloudflare can serve a catalog cache hit before executing the Worker. Such a
request does not reach:

- The Hono route.
- The catalogue rate limiter.
- KV.
- The server source.

Requests that reach the route read the current catalogue from KV. The upstream
source is contacted only when a refresh is required or no valid KV value
exists.

Credential, synchronization, and error responses are not cacheable.

The Worker does not manually emit `Vary: Accept-Encoding` because it does not
produce separate encoded response representations. Cloudflare may manage
transport compression independently.

## Rate Limiting

The catalogue and key routes use separate Cloudflare bindings and namespaces.

Catalogue requests that execute the Worker use:

```text
100 requests per 60 seconds
```

Private-key exchange requests use:

```text
10 requests per 60 seconds
```

Each rate-limit key combines a route scope with the connecting client IP
address.

The counters are enforced independently at Cloudflare locations and are
eventually consistent. They are intended for abuse mitigation rather than
exact global accounting.

Users behind the same NAT gateway, proxy, VPN exit, or other shared public IP
can share a quota.

A rate-limited response returns:

```http
429 Too Many Requests
Retry-After: 60
```

## Credential Handling

The key route:

1. Applies the dedicated key-route rate limiter.
2. Requires same-origin browser request metadata.
3. Validates the incoming JSON body.
4. Validates the 64-character hexadecimal token.
5. Sends the token to the configured credential service.
6. Limits and parses the upstream response.
7. Validates the returned WireGuard private key.
8. Returns the key to the browser.

The route does not enable CORS.

A permitted browser request must have:

```text
Origin equal to the Worker origin
Sec-Fetch-Site equal to same-origin
Sec-Fetch-Mode equal to cors or same-origin
Sec-Fetch-Dest equal to empty
```

This blocks normal cross-origin browser invocation. It does not authenticate
non-browser clients because request headers are not secrets and can be
constructed outside a browser.

The application code does not intentionally store access tokens or returned
private keys in KV or Cloudflare Cache.

Logs contain event names and error messages. The route does not intentionally
log request bodies, tokens, or private keys.

The Worker cannot guarantee that credentials are absent from all
platform-level telemetry or transient infrastructure memory.

## Security Controls

The Worker applies:

- Request body limits.
- Upstream response limits.
- Upstream request timeouts.
- Input schemas.
- Separate public endpoint rate limits.
- Same-origin browser gating for credential exchange.
- Protected manual synchronization.
- Security response headers.
- Non-cacheable credential, synchronization, and error responses.

Public endpoint access behavior and endpoint-specific limits are documented in
[`api.md`](./api.md).