# NordVPN WireGuard Configuration Backend

This project provides a high-performance backend service, built with Bun and Hono, for generating NordVPN WireGuard configurations.

## Features

-   **Dynamic Server List**: Fetches and caches the latest server list from the NordVPN API.
-   **Key Generation**: Securely exchanges a NordVPN token for a WireGuard private key.
-   **Configuration Generation**: Creates customized WireGuard `.conf` files.
-   **Multiple Output Formats**: Delivers configurations as plain text, a downloadable file, or a QR code image.
-   **High Performance**: Utilizes Bun's speed, brotli compression, and efficient caching with background updates.

## Installation

Ensure you have [Bun](https://bun.sh/) installed.

```bash
bun install
```

## Usage

### Development

To run the server in development mode with live-reloading:

```bash
bun run dev
```

### Production

To build and run the server for production:

```bash
bun start
```

The server will be available at `http://localhost:3000`.

## Testing

The project includes a comprehensive test suite using Bun's built-in test runner.

### Running Tests

```bash
# Run the full test suite once
bun test

# Run tests in watch mode
bun test:watch

# Generate a test coverage report
bun test:coverage
```

## API

For detailed endpoint specifications, request/response formats, and validation rules, see the official [API Documentation](API.md).