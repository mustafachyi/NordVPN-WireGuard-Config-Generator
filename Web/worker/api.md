# API documentation

Base URL: `https://[WORKER_DOMAIN]` or the local URL printed by Vite.

## Response format

Successful endpoints return JSON unless otherwise noted. Errors return:

```json
{
  "error": "message"
}
```

Error responses use `Cache-Control: no-store`.

## Get the server catalog

`GET /api/servers`

`HEAD /api/servers` returns the same status and headers without a response body.

Optional request header:

```http
If-None-Match: "etag"
```

Responses:

- `200 OK`: server catalog
- `304 Not Modified`: the supplied ETag matches the current catalog
- `429 Too Many Requests`: rate limit exceeded
- `503 Service Unavailable`: the server catalog is unavailable

Successful responses are browser-cacheable for five minutes. Cloudflare Workers Cache stores them in a tiered edge cache and can serve cache hits without executing Worker code. KV remains the durable source of truth.

The response body is a tuple:

```text
[publicKeyCollection, countries]
```

`publicKeyCollection` is a string containing concatenated 43-character Base64 public keys without their trailing `=` padding.

Each country is:

```text
[countryName, countryCode, cities]
```

Each city starts with:

```text
[cityName, defaultKeyIndex, defaultGroupMask, packedServerData...]
```

The remaining city values contain packed server-number and load data, IP deltas, and an optional exception array. The frontend decoder in `frontend/src/composables/useServers.js` is the reference implementation for this internal format.

Query parameters are rejected because the endpoint has no query semantics and Workers Cache includes the query string in its cache key.

Cross-origin `GET`, `HEAD`, and `OPTIONS` requests are allowed.

## Exchange an access token

`POST /api/key`

Request body:

```json
{
  "token": "64-character hexadecimal string"
}
```

Success response:

```json
{
  "key": "WireGuard private key"
}
```

Responses:

- `200 OK`: key returned
- `400 Bad Request`: invalid request body
- `401 Unauthorized`: expired or rejected NordVPN token
- `413 Content Too Large`: request body exceeds 1 KiB
- `429 Too Many Requests`: rate limit exceeded
- `503 Service Unavailable`: NordVPN credential service unavailable or invalid response

The Worker does not persist the access token or returned private key. Responses use `Cache-Control: no-store`.

Cross-origin `POST` and `OPTIONS` requests are allowed with the `Content-Type` request header.

## Refresh the server cache

`POST /api/sync`

Request header:

```http
Authorization: Bearer <SYNC_TOKEN>
```

Success response:

```json
{
  "success": true
}
```

Responses:

- `200 OK`: refresh completed and the KV cache was updated or confirmed current
- `401 Unauthorized`: missing or invalid synchronization secret
- `502 Bad Gateway`: upstream refresh failed

For local development, `SYNC_TOKEN` is loaded from `worker/.dev.vars`.

For production, `SYNC_TOKEN` must be configured as a Cloudflare Worker secret.

## Rate limiting

`POST /api/key` and uncached `GET /api/servers` executions use separate keys within the same Cloudflare Rate Limiting binding. Each key permits 100 Worker executions per 60 seconds for a client IP and Cloudflare location. Catalog cache hits are served before Worker execution and therefore do not reach the route limiter.

Enforcement is approximate and local to each Cloudflare location.

A rejected request includes:

```http
Retry-After: 60
```