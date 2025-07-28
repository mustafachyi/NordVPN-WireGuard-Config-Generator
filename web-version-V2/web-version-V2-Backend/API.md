# WireGuard Configuration API

## Overview

This API provides services for generating NordVPN WireGuard configurations. It includes endpoints for server discovery, private key generation, and configuration output in multiple formats. The system is designed for high availability and performance, featuring intelligent caching and robust input validation.

## Base URL

`http://localhost:3000`

## Endpoints

### `GET /api/servers`

Retrieves the list of available WireGuard servers, grouped by country and city. This endpoint is cached for performance.

-   **Headers**:
    -   `If-None-Match`: (Optional) ETag for cache validation.
-   **Successful Response (`200 OK`)**:
    -   **Headers**:
        -   `ETag`: The current ETag for the server list.
        -   `Cache-Control`: `public, max-age=300`
    -   **Body**: A JSON object mapping countries to cities, which contain server lists.
-   **Not Modified Response (`304 Not Modified`)**:
    -   Returned if the client's `If-None-Match` header matches the server's ETag.

### `POST /api/key`

Exchanges a valid 64-character hexadecimal NordVPN access token for a WireGuard private key.

-   **Request Body**:
    ```json
    {
      "token": "YOUR_64_CHARACTER_HEX_TOKEN"
    }
    ```
-   **Successful Response (`200 OK`)**:
    ```json
    {
      "key": "A_44_CHARACTER_BASE64_PRIVATE_KEY"
    }
    ```

### `POST /api/config`

Generates a WireGuard configuration as plain text.

-   **Request Body**:
    ```json
    {
      "country": "united_states",
      "city": "new_york",
      "name": "us8675_wireguard",
      "privateKey": "(Optional) Your_44_char_base64_key=",
      "dns": "(Optional) 1.1.1.1,8.8.8.8",
      "endpoint": "(Optional) hostname | station",
      "keepalive": "(Optional) 25"
    }
    ```
-   **Successful Response (`200 OK`)**:
    -   **Content-Type**: `text/plain; charset=utf-8`
    -   **Body**: The WireGuard configuration text.

### `POST /api/config/download`

Generates a WireGuard configuration as a downloadable `.conf` file.

-   **Request Body**: Same as `/api/config`.
-   **Successful Response (`200 OK`)**:
    -   **Content-Type**: `application/x-wireguard-config`
    -   **Content-Disposition**: `attachment; filename="<server_name>.conf"`
    -   **Body**: The WireGuard configuration file content.

### `POST /api/config/qr`

Generates a WireGuard configuration as a WebP QR code image.

-   **Request Body**: Same as `/api/config`.
-   **Successful Response (`200 OK`)**:
    -   **Content-Type**: `image/webp`
    -   **Body**: The WebP image data.

## Validation Rules

| Field        | Rule                                                               |
| :----------- | :----------------------------------------------------------------- |
| `token`      | Must be a 64-character hexadecimal string.                         |
| `country`    | Required. Must be a valid, sanitized server location country.      |
| `city`       | Required. Must be a valid, sanitized server location city.         |
| `name`       | Required. Must be a valid, sanitized server name.                  |
| `privateKey` | Optional. Must be a 44-character Base64 string ending with `=`.    |
| `dns`        | Optional. Must be a comma-separated list of valid IPv4 addresses.  |
| `endpoint`   | Optional. Must be either `"hostname"` or `"station"`.              |
| `keepalive`  | Optional. Must be a number between `15` and `120`.                 |

## Status Codes

| Code   | Meaning                 | Description                                                  |
| :---   | :---------------------- | :----------------------------------------------------------- |
| `200`  | OK                      | The request was successful.                                  |
| `304`  | Not Modified            | The cached resource (`/api/servers`) is still valid.         |
| `400`  | Bad Request             | The request body failed validation.                          |
| `401`  | Unauthorized            | The provided `token` is invalid or expired.                  |
| `404`  | Not Found               | The requested endpoint or server could not be found.         |
| `500`  | Internal Server Error   | An unexpected server-side error occurred.                    |
| `503`  | Service Unavailable     | The NordVPN API is currently unreachable.                    |