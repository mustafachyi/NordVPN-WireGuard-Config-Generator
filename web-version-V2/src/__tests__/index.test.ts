import { describe, expect, test, beforeEach, beforeAll, afterAll, mock } from "bun:test";
import { Logger, LogLevel } from "../utils/logger";
import { 
  makeRequest, 
  mockServerResponse, 
  testServers, 
  validTestToken, 
  invalidTestToken, 
  validConfigRequest 
} from "../utils/__tests__/test-utils";
import type { ConfigRequest } from "../utils/__tests__/test-utils";
import { Hono } from "hono";
import { serve } from "bun";
import { CONFIG_VALIDATION } from '../services/configService';

// Types
type ConsoleSpy = ReturnType<typeof mock>;

// Constants
const TEST_CONFIG = {
  PORT: 3001,
  VALID_DNS: "1.1.1.1",
  INVALID_DNS: "invalid.ip",
  VALID_KEEPALIVE: 30,
  INVALID_KEEPALIVE: 150
} as const;

describe("Nord VPN Config Generator Tests", () => {
  // Test state
  let server: ReturnType<typeof serve>;
  let consoleLogSpy: ConsoleSpy;
  let consoleWarnSpy: ConsoleSpy;
  let consoleErrorSpy: ConsoleSpy;

  // Setup and teardown
  beforeAll(() => {
    server = serve({
      port: TEST_CONFIG.PORT,
      fetch: new Hono().fetch
    });
  });

  afterAll(() => {
    server.stop();
  });

  beforeEach(() => {
    // Reset spies
    consoleLogSpy = mock();
    consoleWarnSpy = mock();
    consoleErrorSpy = mock();
    
    // Replace console methods with spies
    console.log = consoleLogSpy;
    console.warn = consoleWarnSpy;
    console.error = consoleErrorSpy;
  });

  describe("Logger System", () => {
    test("should log messages at appropriate levels", () => {
      Logger.debug("Test", "Debug message");
      Logger.info("Test", "Info message");
      Logger.warn("Test", "Warning message");
      Logger.error("Test", "Error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test("should respect log level filtering", () => {
      Logger.setLogLevel(LogLevel.WARN);
      
      Logger.debug("Test", "Debug message");
      Logger.info("Test", "Info message");
      Logger.warn("Test", "Warning message");
      Logger.error("Test", "Error message");

      expect(consoleLogSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test("should track cache updates", () => {
      const initialCount = Logger.getCacheUpdateCount();
      Logger.incrementCacheUpdate();
      expect(Logger.getCacheUpdateCount()).toBe(initialCount + 1);
    });
  });

  describe("API Endpoints", () => {
    describe("Key Generation", () => {
      test("should generate key with valid token", async () => {
        const response = await makeRequest("POST", "/api/key", { token: validTestToken });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("key");
      });

      test("should reject invalid token", async () => {
        const response = await makeRequest("POST", "/api/key", { token: invalidTestToken });
        expect(response.status).toBe(401);
      });
    });

    describe("Server List", () => {
      test("should return cached server list", async () => {
        mockServerResponse(testServers);
        const response = await makeRequest("GET", "/api/servers");
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("united_states");
      });

      test("should handle 304 responses", async () => {
        const firstResponse = await makeRequest("GET", "/api/servers");
        const etag = firstResponse.headers.get("ETag") || "";
        
        const secondResponse = await makeRequest("GET", "/api/servers", null, {
          "If-None-Match": etag
        });
        
        expect(secondResponse.status).toBe(304);
      });
    });

    describe("Config Generation", () => {
      test("should generate valid config", async () => {
        const response = await makeRequest("POST", "/api/config", validConfigRequest);
        expect(response.status).toBe(200);
        expect(typeof response.body).toBe("string");
      });

      test("should validate DNS format", async () => {
        const response = await makeRequest("POST", "/api/config", {
          ...validConfigRequest,
          dns: TEST_CONFIG.INVALID_DNS
        });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });

      test("should validate keepalive range", async () => {
        const response = await makeRequest("POST", "/api/config", {
          ...validConfigRequest,
          keepalive: TEST_CONFIG.INVALID_KEEPALIVE
        });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });

      test("should accept valid parameters", async () => {
        const response = await makeRequest("POST", "/api/config", {
          ...validConfigRequest,
          dns: TEST_CONFIG.VALID_DNS,
          keepalive: TEST_CONFIG.VALID_KEEPALIVE
        });

        expect(response.status).toBe(200);
      });
    });
  });

  describe("DNS Configuration", () => {
    describe("Validation", () => {
      test("should accept single valid DNS", () => {
        const validRequest = { ...validConfigRequest, dns: "1.1.1.1" };
        expect(CONFIG_VALIDATION.dns(validRequest.dns)).toBe(true);
      });

      test("should accept multiple valid DNS", () => {
        const validRequest = { ...validConfigRequest, dns: "1.1.1.1,8.8.8.8,9.9.9.9" };
        expect(CONFIG_VALIDATION.dns(validRequest.dns)).toBe(true);
      });

      test("should accept multiple DNS with various spacing", () => {
        const validRequest = { ...validConfigRequest, dns: "1.1.1.1,   8.8.8.8,     9.9.9.9" };
        expect(CONFIG_VALIDATION.dns(validRequest.dns)).toBe(true);
      });

      test("should reject if any DNS is invalid", () => {
        const invalidCombos = [
          "1.1.1.1,invalid.ip",
          "1.1.1.1,256.256.256.256",
          "1.1.1.1,8.8.8",
          "1.1.1.1,8.8.8.8."
        ];
        
        invalidCombos.forEach(dns => {
          expect(CONFIG_VALIDATION.dns(dns)).toBe(false);
        });
      });

      test("should handle empty or undefined DNS", () => {
        expect(CONFIG_VALIDATION.dns()).toBe(true);
        expect(CONFIG_VALIDATION.dns("")).toBe(true);
      });
    });

    describe("Configuration Generation", () => {
      test("should generate config with single DNS", async () => {
        const response = await makeRequest("POST", "/api/config", {
          ...validConfigRequest,
          dns: "1.1.1.1"
        });

        expect(response.status).toBe(200);
        expect(response.body).toContain("DNS = 1.1.1.1");
      });

      test("should generate config with multiple DNS", async () => {
        const response = await makeRequest("POST", "/api/config", {
          ...validConfigRequest,
          dns: "1.1.1.1,8.8.8.8"
        });

        expect(response.status).toBe(200);
        expect(response.body).toContain("DNS = 1.1.1.1, 8.8.8.8");
      });

      test("should reject config with invalid DNS combination", async () => {
        const response = await makeRequest("POST", "/api/config", {
          ...validConfigRequest,
          dns: "1.1.1.1,invalid.ip"
        });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });
    });
  });
}); 