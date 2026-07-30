# NordGen Worker

NordGen Worker serves the Vue frontend, distributes the processed NordVPN server catalog, and exchanges NordVPN access tokens for session-only WireGuard private keys.

## Architecture

- Cloudflare Static Assets serves the frontend without invoking Worker code.
- Uncached `/api/*` requests run through the Hono Worker.
- Cloudflare KV stores the current processed server catalog.
- Cloudflare Workers Cache serves catalog hits from a tiered edge cache without executing Worker code.
- A cron trigger refreshes the KV catalog every five minutes.
- Cache-control directives retain stale catalog responses briefly during revalidation and failures.
- The frontend generates WireGuard configuration files, ZIP archives, and QR codes locally.

## Prerequisites

- Bun 1.3.14
- A Cloudflare account with Workers, KV, Static Assets, and Rate Limiting enabled
- A deployed Nord Cache source endpoint

## Local development

Run commands from the repository root.

```cmd
bun install
```

Create `worker/.dev.vars` from `worker/.dev.vars.example`, then set a local synchronization secret.

```cmd
bun run dev
```

The Cloudflare Vite plugin starts the frontend and Worker together.

## Cloudflare configuration

`worker/wrangler.jsonc` defines:

- `NORDGEN_KV`: the catalog KV namespace
- `API_RATE_LIMITER`: the per-location API rate limiter
- `SERVER_SOURCE_URL`: the Nord Cache catalog endpoint
- `NORDVPN_CREDENTIALS_URL`: the NordVPN credential endpoint
- `SYNC_TOKEN`: a required Worker secret
- `ASSETS`: the frontend static-asset binding
- Workers Cache: the tiered catalog response cache

Create the production secret before deployment:

```cmd
bunx wrangler secret put SYNC_TOKEN --config worker\wrangler.jsonc
```

## Verification

```cmd
bun run check
```

```cmd
bun audit
```

## Deployment

```cmd
bun run deploy
```

The root deployment script type-checks the Worker, builds the frontend, uploads the static assets, and deploys the Worker.

## API documentation

See [api.md](./api.md).