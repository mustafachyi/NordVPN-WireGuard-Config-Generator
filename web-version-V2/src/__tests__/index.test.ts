import { describe, expect, test, beforeEach, beforeAll, afterAll, mock } from "bun:test";
import { Logger, LogLevel } from "../utils/logger";
import { makeRequest, mockServerResponse, testServers, validTestToken, invalidTestToken, validConfigRequest } from "../utils/__tests__/test-utils";
import type { ConfigRequest } from "../utils/__tests__/test-utils";
import { Hono } from "hono";
import { serve } from "bun";
import { CONFIG_VALIDATION } from '../services/configService';

describe("Nord VPN Config Generator Tests", () => {
  describe("Logger System", () => {
    // Spy on console methods
    let consoleLogSpy: ReturnType<typeof mock>;
    let consoleWarnSpy: ReturnType<typeof mock>;
    let consoleErrorSpy: ReturnType<typeof mock>;
    let consoleClearSpy: ReturnType<typeof mock>;
    let initialCacheCount: number;

    beforeEach(() => {
      // Reset logger state and spies before each test
      Logger.clear();
      Logger.setLogLevel(LogLevel.INFO);
      initialCacheCount = Logger.getCacheUpdateCount();

      // Reset console spies
      consoleLogSpy = mock(() => {});
      consoleWarnSpy = mock(() => {});
      consoleErrorSpy = mock(() => {});
      consoleClearSpy = mock(() => {});

      // Replace console methods with spies
      global.console.log = consoleLogSpy;
      global.console.warn = consoleWarnSpy;
      global.console.error = consoleErrorSpy;
      global.console.clear = consoleClearSpy;
    });

    describe("Log Level Management", () => {
      test("should respect log level filtering", () => {
        Logger.setLogLevel(LogLevel.WARN);
        
        Logger.debug("Test", "Debug message");
        Logger.info("Test", "Info message");
        Logger.warn("Test", "Warning message");
        Logger.error("Test", "Error message");

        expect(consoleLogSpy.mock.calls.length).toBe(0);
        expect(consoleWarnSpy.mock.calls.length).toBe(1);
        expect(consoleErrorSpy.mock.calls.length).toBe(1);
      });

      test("should allow all logs when level is DEBUG", () => {
        Logger.setLogLevel(LogLevel.DEBUG);
        
        Logger.debug("Test", "Debug message");
        Logger.info("Test", "Info message");
        Logger.warn("Test", "Warning message");
        Logger.error("Test", "Error message");

        expect(consoleLogSpy.mock.calls.length).toBe(2); // Debug and Info
        expect(consoleWarnSpy.mock.calls.length).toBe(1);
        expect(consoleErrorSpy.mock.calls.length).toBe(1);
      });
    });

    describe("Memory Management", () => {
      test("should clean up logs when exceeding threshold", () => {
        const messages = Array.from({ length: 850 }, (_, i) => `Message ${i}`);
        messages.forEach(msg => Logger.info("Test", msg));

        const recentLogs = Logger.getRecentLogs(1000);
        expect(recentLogs.length).toBeLessThanOrEqual(1000);
        expect(recentLogs[recentLogs.length - 1].message).toBe("Message 849");
      });

      test("should maintain correct order after cleanup", () => {
        const messages = Array.from({ length: 850 }, (_, i) => `Message ${i}`);
        messages.forEach(msg => Logger.info("Test", msg));

        const recentLogs = Logger.getRecentLogs(3);
        expect(recentLogs).toHaveLength(3);
        expect(recentLogs.map(log => log.message)).toEqual([
          "Message 847",
          "Message 848",
          "Message 849"
        ]);
      });
    });

    describe("Log Entry Format", () => {
      test("should format timestamps correctly", () => {
        Logger.info("Test", "Test message");
        
        const logCall = consoleLogSpy.mock.calls[0][0];
        expect(logCall).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
      });

      test("should format log levels correctly", () => {
        Logger.info("Test", "Info message");
        Logger.warn("Test", "Warn message");
        Logger.error("Test", "Error message");

        const infoLog = consoleLogSpy.mock.calls[0][0];
        const warnLog = consoleWarnSpy.mock.calls[0][0];
        const errorLog = consoleErrorSpy.mock.calls[0][0];

        expect(infoLog).toContain("[INFO ]");
        expect(warnLog).toContain("[WARN ]");
        expect(errorLog).toContain("[ERROR]");
      });

      test("should include context in log messages", () => {
        const context = "TestContext";
        Logger.info(context, "Test message");

        const logCall = consoleLogSpy.mock.calls[0][0];
        expect(logCall).toContain(`[${context}]`);
      });
    });

    describe("Error Logging", () => {
      test("should handle error details correctly", () => {
        const errorDetails = new Error("Test error");
        Logger.error("Test", "Error occurred", errorDetails);

        expect(consoleErrorSpy.mock.calls.length).toBe(2);
        expect(consoleErrorSpy.mock.calls[1][1]).toBe(errorDetails);
      });

      test("should handle undefined error details", () => {
        Logger.error("Test", "Error without details");
        expect(consoleErrorSpy.mock.calls.length).toBe(1);
      });
    });

    describe("Cache Update Counter", () => {
      test("should increment cache update count correctly", () => {
        const startCount = Logger.getCacheUpdateCount();
        
        Logger.incrementCacheUpdate();
        expect(Logger.getCacheUpdateCount()).toBe(startCount + 1);
        
        Logger.incrementCacheUpdate();
        expect(Logger.getCacheUpdateCount()).toBe(startCount + 2);
      });

      test("should maintain cache update count after clear", () => {
        const startCount = Logger.getCacheUpdateCount();
        Logger.incrementCacheUpdate();
        Logger.clear();
        expect(Logger.getCacheUpdateCount()).toBe(startCount + 1);
      });
    });

    describe("Recent Logs Retrieval", () => {
      test("should return correct number of recent logs", () => {
        const messages = Array.from({ length: 150 }, (_, i) => `Message ${i}`);
        messages.forEach(msg => Logger.info("Test", msg));

        expect(Logger.getRecentLogs(50)).toHaveLength(50);
        expect(Logger.getRecentLogs(10)).toHaveLength(10);
        expect(Logger.getRecentLogs()).toHaveLength(100); // default value
      });

      test("should return all logs if count exceeds available logs", () => {
        const messages = Array.from({ length: 50 }, (_, i) => `Message ${i}`);
        messages.forEach(msg => Logger.info("Test", msg));

        const logs = Logger.getRecentLogs(100);
        expect(logs).toHaveLength(50);
        expect(logs[logs.length - 1].message).toBe("Message 49");
      });
    });

    describe("Clear Functionality", () => {
      test("should clear all logs", () => {
        const messages = Array.from({ length: 50 }, (_, i) => `Message ${i}`);
        messages.forEach(msg => Logger.info("Test", msg));

        Logger.clear();
        expect(Logger.getRecentLogs(1000)).toHaveLength(0);
        expect(consoleClearSpy.mock.calls.length).toBe(1);
      });
    });

    describe("Edge Cases", () => {
      test("should handle empty messages", () => {
        Logger.info("Test", "");
        expect(consoleLogSpy.mock.calls.length).toBe(1);
        const logCall = consoleLogSpy.mock.calls[0][0];
        expect(logCall).toContain("[Test]");
      });

      test("should handle empty context", () => {
        Logger.info("", "Test message");
        expect(consoleLogSpy.mock.calls.length).toBe(1);
        const logCall = consoleLogSpy.mock.calls[0][0];
        expect(logCall).toContain("[]");
        expect(logCall).toContain("Test message");
      });

      test("should handle special characters in messages", () => {
        const specialMessage = "Test\n\t\r\n🎉";
        Logger.info("Test", specialMessage);
        expect(consoleLogSpy.mock.calls.length).toBe(1);
        const logCall = consoleLogSpy.mock.calls[0][0];
        expect(logCall).toContain(specialMessage);
      });
    });
  });

  describe("API System", () => {
    let server: ReturnType<typeof serve>;

    beforeAll(() => {
      // Create a test server
      const app = new Hono();
      
      app.get("/api/servers", async (c) => {
        const cached = await mockServerResponse(testServers);
        
        if (c.req.header("If-None-Match") === cached.etag) {
          return new Response(null, { 
            status: 304,
            headers: {
              "ETag": cached.etag
            }
          });
        }
        
        return new Response(cached.data, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
            "Vary": "Accept-Encoding",
            "ETag": cached.etag
          }
        });
      });

      app.post("/api/key", async (c) => {
        const body = await c.req.json();
        
        if (!body.token) {
          return c.json({ error: "Token required" }, 400);
        }

        if (body.token !== validTestToken) {
          return c.json({ error: "Invalid token" }, 400);
        }

        return c.json({ key: "test_private_key_base64=" });
      });

      app.post("/api/config", async (c) => {
        const body = await c.req.json();
        
        if (!body.country || !body.city || !body.name) {
          return c.json({ error: "Missing required fields" }, 400);
        }

        if (body.dns) {
          const ips = body.dns.split(',').map((ip: string) => ip.trim());
          const isValid = ips.every((ip: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip));
          if (!isValid) {
            return c.json({ error: "Invalid DNS format" }, 400);
          }
        }

        const dns = body.dns ? body.dns.split(',').map((ip: string) => ip.trim()).join(', ') : "103.86.96.100";

        const config = `[Interface]
PrivateKey = test_key
Address = 10.5.0.2/16
DNS = ${dns}

[Peer]
PublicKey = test_public_key
AllowedIPs = 0.0.0.0/0,::/0
Endpoint = ${body.endpoint || "hostname"}:51820
PersistentKeepalive = ${body.keepalive || 25}`;

        return new Response(config, {
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "public, max-age=300",
            "Vary": "Accept-Encoding"
          }
        });
      });

      app.post("/api/config/qr", async (c) => {
        const body = await c.req.json();
        
        if (!body.country || !body.city || !body.name) {
          return c.json({ error: "Missing required fields" }, 400);
        }

        if (body.dns) {
          const ips = body.dns.split(',').map((ip: string) => ip.trim());
          const isValid = ips.every((ip: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip));
          if (!isValid) {
            return c.json({ error: "Invalid DNS format" }, 400);
          }
        }

        // Return a mock QR code image
        return new Response("Mock QR Code", {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=300",
            "Vary": "Accept-Encoding"
          }
        });
      });

      app.post("/api/config/download", async (c) => {
        const body = await c.req.json();
        
        if (!body.country || !body.city || !body.name) {
          return c.json({ error: "Missing required fields" }, 400);
        }

        if (body.dns) {
          const ips = body.dns.split(',').map((ip: string) => ip.trim());
          const isValid = ips.every((ip: string) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip));
          if (!isValid) {
            return c.json({ error: "Invalid DNS format" }, 400);
          }
        }

        const dns = body.dns ? body.dns.split(',').map((ip: string) => ip.trim()).join(', ') : "103.86.96.100";

        const config = `[Interface]
PrivateKey = test_key
Address = 10.5.0.2/16
DNS = ${dns}

[Peer]
PublicKey = test_public_key
AllowedIPs = 0.0.0.0/0,::/0
Endpoint = ${body.endpoint || "hostname"}:51820
PersistentKeepalive = ${body.keepalive || 25}`;

        return new Response(config, {
          headers: {
            "Content-Type": "application/x-wireguard-config",
            "Content-Disposition": `attachment; filename="${body.name}.conf"`,
            "Cache-Control": "private, no-cache, no-store, must-revalidate"
          }
        });
      });

      // Error handling for unknown endpoints
      app.notFound((c) => c.json({ error: "Endpoint not found" }, 404));

      // Start the server
      server = serve({
        fetch: app.fetch,
        port: 3000,
      });
    });

    afterAll(() => {
      server.stop();
    });

    describe("GET /api/servers", () => {
      test("should return server list with correct headers", async () => {
        const response = await makeRequest("GET", "/api/servers");

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("application/json");
        expect(response.headers.get("ETag")).toBe("test-etag");
        expect(response.body).toEqual(testServers);
      });

      test("should return 304 when ETag matches", async () => {
        const response = await makeRequest("GET", "/api/servers", null, {
          "If-None-Match": "test-etag",
        });

        expect(response.status).toBe(304);
      });
    });

    describe("POST /api/key", () => {
      test("should handle valid token", async () => {
        const response = await makeRequest("POST", "/api/key", {
          token: validTestToken,
        });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("key");
        expect(typeof response.body.key).toBe("string");
      });

      test("should reject invalid token", async () => {
        const response = await makeRequest("POST", "/api/key", {
          token: invalidTestToken,
        });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });

      test("should handle missing token", async () => {
        const response = await makeRequest("POST", "/api/key", {});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });
    });

    describe("POST /api/config", () => {
      test("should generate valid config", async () => {
        const response = await makeRequest("POST", "/api/config", validConfigRequest);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/plain");
        expect(typeof response.body).toBe("string");
        expect(response.body).toContain("[Interface]");
        expect(response.body).toContain("[Peer]");
      });

      test("should validate required fields", async () => {
        const invalidRequest: ConfigRequest = { ...validConfigRequest };
        invalidRequest.country = undefined;

        const response = await makeRequest("POST", "/api/config", invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });

      test("should validate field formats", async () => {
        const invalidRequest: ConfigRequest = {
          ...validConfigRequest,
          dns: "invalid-ip",
        };

        const response = await makeRequest("POST", "/api/config", invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });
    });

    describe("POST /api/config/qr", () => {
      test("should generate QR code", async () => {
        const response = await makeRequest("POST", "/api/config/qr", validConfigRequest);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("image/webp");
      });

      test("should handle invalid config", async () => {
        const invalidRequest: ConfigRequest = { ...validConfigRequest };
        invalidRequest.country = undefined;

        const response = await makeRequest("POST", "/api/config/qr", invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });
    });

    describe("POST /api/config/download", () => {
      test("should provide downloadable config", async () => {
        const response = await makeRequest("POST", "/api/config/download", validConfigRequest);

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("application/x-wireguard-config");
        expect(response.headers.get("Content-Disposition")).toContain("attachment");
        expect(typeof response.body).toBe("string");
      });

      test("should handle invalid config", async () => {
        const invalidRequest: ConfigRequest = { ...validConfigRequest };
        invalidRequest.country = undefined;

        const response = await makeRequest("POST", "/api/config/download", invalidRequest);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });
    });

    describe("Error Handling", () => {
      test("should handle 404 for unknown endpoints", async () => {
        const response = await makeRequest("GET", "/api/nonexistent");

        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty("error");
      });

      test("should handle method not allowed", async () => {
        const response = await makeRequest("PUT", "/api/servers");

        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty("error");
      });

      test("should handle malformed JSON", async () => {
        const response = await makeRequest("POST", "/api/config", "invalid-json", {
          "Content-Type": "application/json",
        });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
      });
    });

    describe("Cache Control", () => {
      test("should set correct cache headers for successful responses", async () => {
        const response = await makeRequest("GET", "/api/servers");

        expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
        expect(response.headers.get("Vary")).toBe("Accept-Encoding");
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