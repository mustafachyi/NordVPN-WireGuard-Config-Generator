# WireGuard Configuration API Documentation

## Overview
This API provides endpoints for generating WireGuard configurations for NordVPN servers. It includes server selection, configuration generation, and multiple output formats (plain text, downloadable files, and QR codes).

## Base URL
```
http://localhost:3000
```

## Cache Behavior
- Server list is cached for 4.5 minutes
- Cache is updated in background after threshold
- Uses ETags for client-side caching
- Automatic retry mechanism (3 attempts) for failed cache updates

## API Endpoints

### 1. Server List
```http
GET /api/servers
```

Returns available WireGuard servers grouped by country and city.

**Headers:**
- `If-None-Match`: (Optional) ETag for cache validation
- `Accept-Encoding`: Supports Brotli compression

**Response Headers:**
- `ETag`: Cache validation token
- `Content-Type`: application/json
- `Cache-Control`: public, max-age=300

**Success Response Format:**
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

**Status Codes:**
- 200: Success with data
- 304: Not Modified (when ETag matches)

### 2. Private Key Generation
```http
POST /api/key
```

Generates WireGuard private key using NordVPN's API.

**Request Body:**
```json
{
  "token": "64_character_hex_string"
}
```

**Token Format:**
- Length: 64 characters
- Pattern: ^[a-f0-9]{64}$
- Case-insensitive

**Success Response:**
```json
{
  "key": "base64_encoded_private_key"
}
```

**Error Response:**
```json
{
  "error": "error_message"
}
```

**Status Codes:**
- 200: Success
- 400: Invalid token format
- 401: Invalid/unauthorized token
- 503: NordVPN API unavailable

### 3. Configuration View
```http
POST /api/config
```

Returns WireGuard configuration as plain text.

**Request Body:**
```json
{
  "country": "united_states",
  "city": "new_york",
  "name": "us8675_wireguard",
  "privateKey": "base64_private_key=",
  "dns": "103.86.96.100",
  "endpoint": "hostname",
  "keepalive": 25
}
```

**Field Requirements:**
- `country`: Lowercase, underscored string
- `city`: Lowercase, underscored string
- `name`: Server name as returned by /api/servers
- `privateKey`: (Optional) 44-char Base64 string ending with '='
- `dns`: (Optional) Valid IPv4 address
- `endpoint`: (Optional) "hostname" or "station"
- `keepalive`: (Optional) Number between 15-120

**Response:**
- Content-Type: text/plain; charset=utf-8
- Raw WireGuard configuration text

### 4. Configuration Download
```http
POST /api/config/download
```

Returns configuration as downloadable .conf file.
Same request body as /api/config.

**Response Headers:**
- Content-Type: application/x-wireguard-config
- Content-Disposition: attachment; filename="servername.conf"
- Cache-Control: private, no-cache, no-store, must-revalidate

### 5. QR Code Generation
```http
POST /api/config/qr
```

Returns configuration as QR code image.
Same request body as /api/config.

**QR Specifications:**
- Image Format: WebP (nearLossless)
- Size: 200px
- Margin: 1
- Error Correction: Level L

**Response Headers:**
- Content-Type: image/webp
- Content-Length: [size in bytes]

## Configuration Format
```ini
[Interface]
PrivateKey=[44_char_base64_key]
Address=10.5.0.2/16
DNS=[dns_ip]

[Peer]
PublicKey=[server_public_key]
AllowedIPs=0.0.0.0/0,::/0
Endpoint=[hostname/station]:51820
PersistentKeepalive=[keepalive_value]
```

## Error Handling

### Common Error Responses
```json
{
  "error": "detailed_error_message"
}
```

### Status Codes
- 200: Success
- 304: Not Modified (caching)
- 400: Invalid request parameters
- 401: Authentication failed
- 404: Server not found
- 500: QR generation failed
- 503: External service unavailable

## Server Name Sanitization
- Converted to lowercase
- Special characters replaced with underscore
- Multiple underscores collapsed
- Leading/trailing underscores removed
- Pattern: /[\/\\:*?"<>|#]/g → '_'

## Rate Limiting & Caching
- Server list cached for 4.5 minutes
- Background updates to prevent stale data
- ETags for client-side caching
- Brotli compression for responses > 512 bytes
