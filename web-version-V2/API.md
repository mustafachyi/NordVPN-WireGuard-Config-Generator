# WireGuard Configuration API

## Overview
API for generating WireGuard configurations for NordVPN servers, providing server selection, configuration generation, and multiple output formats.

## Base URL
```
http://localhost:3000
```

## Caching
- Server list: 4.5 minutes
- Background updates
- ETags support
- Auto-retry (3 attempts)

## Endpoints

### GET /api/servers
Returns available WireGuard servers by location.

**Headers:**
- `If-None-Match`: ETag for caching
- `Accept-Encoding`: Supports brotli

**Response Headers:**
- `ETag`: Cache validation token
- `Cache-Control`: public, max-age=300

**Response:**
```json
{
  "united_states": {
    "new_york": [
      {
        "name": "us8675_wireguard",
        "load": 45
      }
    ]
  }
}
```

### POST /api/key
Generates WireGuard private key using NordVPN token.

**Request:**
```json
{
  "token": "64_char_hex_token"  // Case-insensitive hex string
}
```

**Response:**
```json
{
  "key": "44_char_base64_key"  // Base64 string ending with '='
}
```

**Errors:**
- 400: Invalid token format
- 401: Invalid/unauthorized token
- 503: NordVPN API unavailable

### POST /api/config
Generates WireGuard configuration.

**Request:**
```json
{
  "country": "united_states",
  "city": "new_york",
  "name": "us8675_wireguard",
  "privateKey": "optional_44_char_key",  // Base64 ending with '='
  "dns": "optional_dns_ips",            // Single or comma-separated IPs
  "endpoint": "hostname|station",       // Default: hostname
  "keepalive": 15                      // Range: 15-120, Default: 25
}
```

**Response:** Plain text WireGuard config

### POST /api/config/qr
Returns configuration as QR code (WebP format).

**Request:** Same as `/api/config`  
**Response:** WebP image

### POST /api/config/download
Downloads configuration as .conf file.

**Request:** Same as `/api/config`  
**Response:** Downloadable config file

## Configuration Format
```ini
[Interface]
PrivateKey=[44_char_base64_key]
Address=10.5.0.2/16
DNS=1.1.1.1, 8.8.8.8      # Default: 103.86.96.100

[Peer]
PublicKey=[server_public_key]
AllowedIPs=0.0.0.0/0,::/0
Endpoint=[hostname/station]:51820
PersistentKeepalive=[15-120]          # Default: 25
```

## Validation Rules
- **Private Key**: 44-char Base64 string ending with '='
- **DNS**: IPv4 addresses, comma-separated
- **Token**: 64-char hex string (case-insensitive)
- **Keepalive**: Number between 15-120
- **Server Names**: Alphanumeric with underscores

## Status Codes
- 200: Success
- 304: Not Modified (cache)
- 400: Invalid request
- 401: Auth failed
- 404: Server not found
- 500: QR generation failed
- 503: Service unavailable

## Server Names
- Lowercase
- Special chars to underscore
- Multiple underscores collapsed
- No leading/trailing underscores
- Pattern: `/[\/\\:*?"<>|#]/g` → `_`

## Performance
- Brotli compression (>512 bytes)
- ETags for caching
- Background cache updates
- Optimized response formats
