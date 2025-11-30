# API Documentation

Base URL: `http://localhost:3000`

## Response Format

- **Success**: Returns standard JSON with a `200 OK` status code.
- **Error**: Returns a JSON object `{"error": "message"}` with an appropriate HTTP status code (400, 401, 404, 500, 503).

## Endpoints

### 1. Get Server List

Retrieves the cached list of available WireGuard-compatible NordVPN servers.

**Endpoint:** `GET /api/servers`

**Headers:**
- `If-None-Match`: (Optional) The ETag from a previous request.

**Response:**
- **200 OK**: Returns the server data.
- **304 Not Modified**: If the provided ETag matches the current data version.
- **503 Service Unavailable**: If the server cache is initializing.

**Response Body Structure:**
The data is optimized for network payload size.
- `h`: Array of column headers (e.g., `["name", "load", "station"]`).
- `l`: Nested object structure: `Country -> City -> Array of Servers`.
  - Each server is an array matching the headers in `h`.

### 2. Exchange Token

Exchanges a NordVPN access token for a WireGuard private key.

**Endpoint:** `POST /api/key`

**Request Body:**
```json
{
  "token": "string"
}
```

**Validation:**
- `token`: Must be a 64-character hexadecimal string.

**Response:**
```json
{
  "key": "string" // The NordLynx private key
}
```

### 3. Generate Configuration

Generates a WireGuard configuration based on the selected server and user credentials.

**Endpoints:**
- `POST /api/config` - Returns configuration as plain text.
- `POST /api/config/download` - Returns configuration as a downloadable `.conf` file.
- `POST /api/config/qr` - Returns configuration as a PNG QR code image.

**Request Body:**
```json
{
  "country": "string",    // Required
  "city": "string",       // Required
  "name": "string",       // Required (Server name, e.g., "us1234")
  "privateKey": "string", // Optional (If not provided, config will be invalid)
  "dns": "string",        // Optional (Comma separated IPs, default: 103.86.96.100)
  "endpoint": "string",   // Optional ("hostname" or "station", default: hostname)
  "keepalive": number     // Optional (15-120, default: 25)
}
```

**Validation Rules:**
- `privateKey`: Must be a valid Base64 WireGuard key (43 characters ending in `=`).
- `dns`: Must be valid IPv4 addresses.
- `keepalive`: Must be an integer between 15 and 120.

**Response Headers:**
- **Text**: `Content-Type: text/plain`
- **File**: `Content-Type: application/x-wireguard-config`, `Content-Disposition: attachment`
- **QR**: `Content-Type: image/png`

## Rate Limiting

API endpoints are rate-limited to **100 requests per 1 minute per IP address**.