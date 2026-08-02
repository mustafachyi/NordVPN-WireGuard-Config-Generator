# NordGen Worker

NordGen Worker serves the browser application and provides the API used by its server catalogue and private-key generator.

The browser creates configuration files, ZIP archives, and QR codes locally. The Worker handles server data, credential exchange, and catalogue synchronization.

## Responsibilities

The deployment is divided into four parts:

| Component | Responsibility |
|---|---|
| Static Assets | Serves the compiled Vue application |
| Hono Worker | Handles `/api/*` requests |
| Cloudflare KV | Stores the latest validated server catalogue |
| Cloudflare Cache | Caches catalogue responses close to clients |

A scheduled task refreshes the catalogue every five minutes.

## Request Flow

Requests under `/api/` are passed to the Hono application.

Other requests are served through the `ASSETS` binding.

The API contains three routes:

| Route | Purpose |
|---|---|
| `/api/servers` | Returns the processed server catalogue |
| `/api/key` | Exchanges an access token for a private key |
| `/api/sync` | Performs an authenticated catalogue refresh |

Detailed request and response formats are documented in [`api.md`](./api.md).

## Cloudflare Bindings

`worker/wrangler.jsonc` defines the following bindings and variables:

| Name | Purpose |
|---|---|
| `NORDGEN_KV` | Stores the validated catalogue and ETag metadata |
| `API_RATE_LIMITER` | Limits public API requests |
| `ASSETS` | Serves the compiled frontend |
| `SERVER_SOURCE_URL` | Provides the packed server catalogue |
| `NORDVPN_CREDENTIALS_URL` | Exchanges NordVPN access tokens |
| `SYNC_TOKEN` | Protects manual catalogue synchronization |

The configuration also defines:

- The production custom domain
- The five-minute cron trigger
- Cache support
- Static-asset routing
- Observability

The namespace identifiers, custom domain, source URL, and route configuration are specific to this deployment. Forks must replace them before deployment.

## Prerequisites

- Bun 1.3.14
- A Cloudflare account for production deployment
- A Workers KV namespace
- A Workers Rate Limiting binding
- A compatible server-catalogue source
- A synchronization secret

## Local Setup

Run all commands in this section from the `Web` directory.

Install dependencies:

````cmd
bun install
````

Create `worker/.dev.vars` from `worker/.dev.vars.example`.

The local file must contain:

````dotenv
SYNC_TOKEN=replace-with-a-random-secret
````

Do not commit `worker/.dev.vars`.

Start the frontend and Worker development environment:

````cmd
bun run dev
````

The Cloudflare Vite plugin starts both parts through the frontend Vite configuration.

## Verification

Generate the Worker binding types, run TypeScript checking, and build the frontend:

````cmd
bun run check
````

Audit installed dependencies:

````cmd
bun audit
````

`bun run check` performs the following sequence:

````text
wrangler types
TypeScript type checking
Vite production build
````

It does not run `bun audit`.

## Production Secret

Create the synchronization secret before deployment:

````cmd
bunx wrangler secret put SYNC_TOKEN --config worker\wrangler.jsonc
````

The secret value is stored by Cloudflare and is not written into `wrangler.jsonc`.

## Deployment

Deploy from the `Web` directory:

````cmd
bun run deploy
````

The deployment script:

1. Generates Worker binding types.
2. Runs TypeScript checking.
3. Builds the frontend.
4. Uploads the static assets.
5. Deploys the Worker.

Dependency auditing remains a separate command.

## Catalogue Storage

The latest validated catalogue is stored in KV with:

- A content-derived ETag
- The source ETag when one is available
- The exact validated JSON response

During refresh, the Worker sends the previous source validator through `If-None-Match`.

A `304 Not Modified` source response keeps the current catalogue.

A changed response is validated before KV is updated.

A failed scheduled refresh is logged and does not delete the existing KV value.

## Cache Behavior

Successful catalogue responses provide browser and Cloudflare cache directives.

Cached catalogue responses can be served without running the route handler.

Requests that reach the Worker read the current catalogue from KV. The upstream source is contacted only when a refresh is required or no valid KV value exists.

Credential, synchronization, and error responses are not cacheable.

## Credential Handling

The key route:

1. Validates the incoming JSON body.
2. Validates the 64-character hexadecimal token.
3. Sends the token to the configured credential service.
4. Limits and parses the upstream response.
5. Validates the returned WireGuard private key.
6. Returns the key to the browser.

Application code does not intentionally store access tokens or returned private keys in KV or Cloudflare Cache.

Logs contain event names and error messages. The route does not intentionally log request bodies, tokens, or private keys.

The Worker cannot guarantee that credentials are absent from all platform-level telemetry or transient infrastructure memory.

## Security Controls

The Worker applies:

- Request body limits
- Upstream response limits
- Upstream request timeouts
- Input schemas
- Public API rate limiting
- Protected manual synchronization
- Security response headers
- Non-cacheable error responses

Public CORS behavior and endpoint-specific limits are documented in [`api.md`](./api.md).