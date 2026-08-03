# NordGen API

The API is available under the deployed Worker domain.

Production base URL:

```text
https://nordgen.selfhoster.win
```

All application endpoints use the `/api` prefix.

## Common Behavior

Error responses use this JSON structure:

```json
{
  "error": "Message"
}
```

Responses with status codes of `400` or higher use:

```http
Cache-Control: no-store
```

API responses include:

```http
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

Unknown API paths return:

| Status                      | Meaning                             |
| --------------------------- | ----------------------------------- |
| `404 Not Found`             | No API route matched                |
| `500 Internal Server Error` | An unhandled request error occurred |

## Cross-Origin Access

| Route          | Allowed cross-origin methods | Allowed request headers |
| -------------- | ---------------------------- | ----------------------- |
| `/api/servers` | `GET`, `HEAD`, `OPTIONS`     | `If-None-Match`         |
| `/api/key`     | `POST`, `OPTIONS`            | `Content-Type`          |
| `/api/sync`    | None                         | None                    |

The public routes allow any origin.

CORS preflight responses may be cached for 86400 seconds.

## Server Catalogue

```http
GET /api/servers
```

A bodyless request is also supported:

```http
HEAD /api/servers
```

Query parameters are not supported.

### Conditional Requests

Clients may send:

```http
If-None-Match: W/"sha256-..."
```

A matching ETag returns:

```http
304 Not Modified
```

The ETag comparison accepts weak and strong forms of the same value.

### Successful Response

```http
200 OK
Content-Type: application/json; charset=utf-8
ETag: W/"sha256-..."
Cache-Control: public, max-age=300, stale-while-revalidate=60, stale-if-error=86400
Vary: Accept-Encoding
```

The response body contains two values:

```text
[publicKeyCollection, countries]
```

`publicKeyCollection` contains concatenated 43-character Base64 public keys without their final `=` padding.

Each country has this structure:

```text
[countryName, countryCode, cities]
```

Each city begins with:

```text
[cityName, defaultKeyIndex, defaultGroupMask, packedServerData...]
```

The packed values contain server identifiers, load values, IPv4 deltas, public-key references, group masks, and optional exceptions.

The reference decoder is:

```text
frontend/src/composables/useServers.js
```

### Responses

| Status                    | Meaning                          |
| ------------------------- | -------------------------------- |
| `200 OK`                  | Catalogue returned               |
| `304 Not Modified`        | ETag matched                     |
| `400 Bad Request`         | Query parameters were supplied   |
| `429 Too Many Requests`   | Rate limit exceeded              |
| `503 Service Unavailable` | No valid catalogue was available |

### Caching

The successful response is cacheable for five minutes.

It also permits:

* 60 seconds of stale content during revalidation.
* 86400 seconds of stale content when an error prevents a normal refresh.

A Cloudflare cache hit may be served before Worker route execution.

Requests that reach the route use KV as the catalogue source. The route refreshes from the configured upstream source only when KV does not contain a valid catalogue.

The ETag is generated from a SHA-256 digest of the exact catalogue JSON.

## Private-Key Exchange

```http
POST /api/key
Content-Type: application/json
```

### Request Body

```json
{
  "token": "64-character hexadecimal token"
}
```

The JSON object must contain only the `token` field.

The request body limit is 1024 bytes.

### Successful Response

```http
200 OK
Cache-Control: no-store
```

```json
{
  "key": "Base64-encoded WireGuard private key"
}
```

The returned value must represent exactly 32 decoded bytes.

### Responses

| Status                    | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `200 OK`                  | Private key returned                                        |
| `400 Bad Request`         | JSON body or token was invalid                              |
| `401 Unauthorized`        | The upstream credential service returned `401`              |
| `413 Content Too Large`   | Request body exceeded 1024 bytes                            |
| `429 Too Many Requests`   | Rate limit exceeded                                         |
| `503 Service Unavailable` | The upstream request failed or returned an invalid response |

The access token and returned key are not intentionally stored by application code.

## Manual Synchronization

```http
POST /api/sync
Authorization: Bearer <SYNC_TOKEN>
```

The request has no required body.

### Successful Response

```http
200 OK
Cache-Control: no-store
```

```json
{
  "success": true
}
```

### Responses

| Status             | Meaning                                       |
| ------------------ | --------------------------------------------- |
| `200 OK`           | Refresh completed or the source was unchanged |
| `401 Unauthorized` | Synchronization token was missing or invalid  |
| `502 Bad Gateway`  | Catalogue refresh failed                      |

The provided token and configured secret are hashed before a timing-safe comparison.

This route does not enable cross-origin access.

## Rate Limiting

The configured public limit is:

```text
100 requests per 60 seconds
```

Separate scopes are used for:

* Server catalogue requests that reach the Worker.
* Private-key exchange requests.

Each rate-limit key includes the connecting client IP address.

When `cf-connecting-ip` is unavailable, the fallback key is `local`.

Cloudflare cache hits can bypass Worker execution and therefore do not reach the route limiter.

A rejected request includes:

```http
429 Too Many Requests
Retry-After: 60
```

The `Retry-After` header is exposed through CORS on the public routes.

## Limits

| Operation                   | Limit      |
| --------------------------- | ---------- |
| Incoming key request body   | 1024 bytes |
| Credential-service response | 16 KiB     |
| Server-source response      | 8 MiB      |
| Upstream request duration   | 15 seconds |

## Catalogue Validation

Before a source response is stored, the Worker checks that it:

* Is valid JSON.
* Contains a public-key collection in the expected format.
* Contains a country array.
* Uses the required country and city tuple structure.

The browser applies additional validation while decoding individual records.