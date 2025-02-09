# Nord VPN Config Generator Backend

A Bun-based backend service for generating WireGuard configurations for NordVPN.

## Installation

```bash
bun install
```

## Development

```bash
# Start the server in development mode with auto-reload
bun run dev

# Start the server in production mode
bun start
```

## Testing

The project uses Bun's built-in test runner with comprehensive test coverage.

### Available Test Commands

```bash
# Run all tests
bun test

# Run tests in watch mode (auto-rerun on file changes)
bun test:watch

# Run tests with coverage report
bun test:coverage
```

### Test Structure

Tests are organized following the project structure:
- Unit tests are placed next to the files they test
- Test files follow the naming pattern: `*.test.ts`
- Tests are grouped by functionality using describe blocks

### Writing Tests

Example of a test file:
```typescript
import { describe, expect, test } from "bun:test";

describe("Feature", () => {
  test("should work as expected", () => {
    // Test implementation
  });
});
```

### Test Coverage

Coverage reports are generated in the `coverage` directory when running `bun test:coverage`. The configuration ensures:
- All source files are included
- Test files are excluded from coverage
- Declaration files are excluded

## API Documentation

See [API.md](API.md) for detailed API documentation.
