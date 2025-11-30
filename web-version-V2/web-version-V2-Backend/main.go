package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nordgen/internal/store"
	"nordgen/internal/types"
	"nordgen/internal/wg"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/skip2/go-qrcode"
)

var (
	rxToken    = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
	rxKey      = regexp.MustCompile(`^[A-Za-z0-9+/]{43}=$`)
	rxIPv4     = regexp.MustCompile(`^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$`)
	httpClient = &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			IdleConnTimeout:     90 * time.Second,
		},
	}
)

func validateConfig(b types.ConfigRequest) (types.ValidatedConfig, string) {
	var errs []string
	if b.Country == "" {
		errs = append(errs, "Missing country")
	}
	if b.City == "" {
		errs = append(errs, "Missing city")
	}
	if b.Name == "" {
		errs = append(errs, "Missing name")
	}
	if b.PrivateKey != "" && !rxKey.MatchString(b.PrivateKey) {
		errs = append(errs, "Invalid Private Key")
	}

	cleanDns := "103.86.96.100"
	if b.DNS != "" {
		parts := strings.Split(b.DNS, ",")
		valid := true
		for _, p := range parts {
			if !rxIPv4.MatchString(strings.TrimSpace(p)) {
				valid = false
				break
			}
		}
		if !valid {
			errs = append(errs, "Invalid DNS IP")
		} else {
			cleanDns = b.DNS
		}
	}

	if b.Endpoint != "" && b.Endpoint != "hostname" && b.Endpoint != "station" {
		errs = append(errs, "Invalid endpoint type")
	}

	ka := 25
	if b.KeepAlive != nil {
		if *b.KeepAlive < 15 || *b.KeepAlive > 120 {
			errs = append(errs, "Invalid keepalive")
		} else {
			ka = *b.KeepAlive
		}
	}

	if len(errs) > 0 {
		return types.ValidatedConfig{}, strings.Join(errs, ", ")
	}

	return types.ValidatedConfig{
		Name:       b.Name,
		PrivateKey: b.PrivateKey,
		DNS:        cleanDns,
		UseStation: b.Endpoint == "station",
		KeepAlive:  ka,
	}, ""
}

func main() {
	store.Core.Init()

	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
		BodyLimit:             4 * 1024 * 1024,
	})

	app.Use(cors.New())

	api := app.Group("/api")
	api.Use(limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			if k := c.Get("x-test-key"); k != "" {
				return k
			}
			return c.IP()
		},
	}))
	api.Use(compress.New())

	api.Get("/servers", func(c *fiber.Ctx) error {
		data, etag := store.Core.GetServerList()
		if data == nil {
			return c.Status(503).JSON(fiber.Map{"error": "Initializing"})
		}
		if c.Get("if-none-match") == etag {
			return c.SendStatus(304)
		}
		c.Set("ETag", etag)
		c.Set("Cache-Control", "public, max-age=300")
		c.Set("Content-Type", "application/json; charset=utf-8")
		return c.Send(data)
	})

	api.Post("/key", func(c *fiber.Ctx) error {
		var body struct {
			Token string `json:"token"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.SendStatus(400)
		}

		if !rxToken.MatchString(body.Token) {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid token"})
		}

		req, _ := http.NewRequest("GET", "https://api.nordvpn.com/v1/users/services/credentials", nil)
		req.Header.Set("Authorization", "Bearer token:"+body.Token)

		resp, err := httpClient.Do(req)
		if err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "Upstream error"})
		}
		defer resp.Body.Close()

		if resp.StatusCode == 401 {
			return c.Status(401).JSON(fiber.Map{"error": "Expired token"})
		}
		if resp.StatusCode != 200 {
			return c.Status(503).JSON(fiber.Map{"error": "Upstream error"})
		}

		var data struct {
			Key string `json:"nordlynx_private_key"`
		}
		if json.NewDecoder(resp.Body).Decode(&data) != nil {
			return c.SendStatus(500)
		}

		return c.JSON(fiber.Map{"key": data.Key})
	})

	handleConfig := func(c *fiber.Ctx, outputType string) error {
		var body types.ConfigRequest
		if err := c.BodyParser(&body); err != nil {
			return c.SendStatus(400)
		}

		cfg, errMsg := validateConfig(body)
		if errMsg != "" {
			return c.Status(400).JSON(fiber.Map{"error": errMsg})
		}

		srv, ok := store.Core.GetServer(cfg.Name)
		if !ok {
			return c.Status(404).JSON(fiber.Map{"error": "Server not found"})
		}

		pk, ok := store.Core.GetKey(srv.KeyID)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "Key missing"})
		}

		confContent := wg.Build(srv, pk, cfg)
		c.Set("Cache-Control", "no-store")

		if outputType == "text" {
			return c.SendString(confContent)
		}

		if outputType == "file" {
			num := regexp.MustCompile(`\d+`).FindString(srv.Name)
			if num == "" {
				num = "wg"
			}
			fname := fmt.Sprintf("%s%s.conf", srv.Country[0:2], num)
			c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fname))
			c.Set("Content-Type", "application/x-wireguard-config")
			return c.SendString(confContent)
		}

		png, err := qrcode.Encode(confContent, qrcode.Medium, 256)
		if err != nil {
			return c.SendStatus(500)
		}
		c.Set("Content-Type", "image/png")
		return c.Send(png)
	}

	api.Post("/config", func(c *fiber.Ctx) error { return handleConfig(c, "text") })
	api.Post("/config/download", func(c *fiber.Ctx) error { return handleConfig(c, "file") })
	api.Post("/config/qr", func(c *fiber.Ctx) error { return handleConfig(c, "qr") })

	app.Use(func(c *fiber.Ctx) error {
		path := c.Path()
		asset := store.Core.GetAsset(path)

		if asset == nil {
			if strings.HasPrefix(path, "/api") {
				return c.Status(404).JSON(fiber.Map{"message": "Endpoint not found"})
			}
			asset = store.Core.GetAsset("/index.html")
			if asset != nil {
				c.Set("Content-Type", "text/html")
				return c.Send(asset.Content)
			}
			return c.SendStatus(404)
		}

		if c.Get("if-none-match") == asset.Etag {
			return c.SendStatus(304)
		}

		c.Set("ETag", asset.Etag)
		c.Set("Content-Type", asset.Mime)

		cc := "public, max-age=300"
		if strings.HasPrefix(path, "/assets") {
			cc = "public, max-age=31536000, immutable"
		}
		c.Set("Cache-Control", cc)

		if asset.Brotli != nil && strings.Contains(c.Get("accept-encoding"), "br") {
			c.Set("Content-Encoding", "br")
			return c.Send(asset.Brotli)
		}
		return c.Send(asset.Content)
	})

	app.Listen(":3000")
}
