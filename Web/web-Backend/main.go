package main

import (
	"bufio"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nordgen/internal/store"
	"nordgen/internal/types"
	"nordgen/internal/wg"

	"github.com/bytedance/sonic"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/limiter"
	"github.com/klauspost/compress/zip"
	"github.com/skip2/go-qrcode"
)

var httpClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	},
}

func isHex(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < 64; i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func isKey(s string) bool {
	if len(s) != 44 {
		return false
	}
	if s[43] != '=' {
		return false
	}
	for i := 0; i < 43; i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '+' || c == '/') {
			return false
		}
	}
	return true
}

func isIPv4(s string) bool {
	if len(s) == 0 {
		return false
	}
	dots := 0
	num := 0
	hasNum := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '.' {
			if !hasNum || num > 255 {
				return false
			}
			dots++
			num = 0
			hasNum = false
		} else if c >= '0' && c <= '9' {
			num = num*10 + int(c-'0')
			if num > 255 {
				return false
			}
			hasNum = true
		} else {
			return false
		}
	}
	return dots == 3 && hasNum && num <= 255
}

func parseCommon(key, dns, endpoint string, keepAlive *int) (types.ValidatedConfig, []string) {
	var errs []string
	if key != "" && !isKey(key) {
		errs = append(errs, "Invalid Private Key")
	}

	cleanDns := "103.86.96.100"
	if dns != "" {
		valid := true
		start := 0
		for i := 0; i <= len(dns); i++ {
			if i == len(dns) || dns[i] == ',' {
				part := strings.TrimSpace(dns[start:i])
				if !isIPv4(part) {
					valid = false
					break
				}
				start = i + 1
			}
		}
		if !valid {
			errs = append(errs, "Invalid DNS IP")
		} else {
			cleanDns = dns
		}
	}

	if endpoint != "" && endpoint != "hostname" && endpoint != "station" {
		errs = append(errs, "Invalid endpoint type")
	}

	ka := 25
	if keepAlive != nil {
		if *keepAlive < 15 || *keepAlive > 120 {
			errs = append(errs, "Invalid keepalive")
		} else {
			ka = *keepAlive
		}
	}

	return types.ValidatedConfig{
		PrivateKey: key,
		DNS:        cleanDns,
		UseStation: endpoint == "station",
		KeepAlive:  ka,
	}, errs
}

func validateConfig(b types.ConfigRequest) (types.ValidatedConfig, string) {
	cfg, errs := parseCommon(b.PrivateKey, b.DNS, b.Endpoint, b.KeepAlive)

	if b.Country == "" {
		errs = append(errs, "Missing country")
	}
	if b.City == "" {
		errs = append(errs, "Missing city")
	}
	if b.Name == "" {
		errs = append(errs, "Missing name")
	}

	cfg.Name = b.Name
	if len(errs) > 0 {
		return types.ValidatedConfig{}, strings.Join(errs, ", ")
	}
	return cfg, ""
}

func validateBatch(b types.BatchConfigReq) (types.ValidatedConfig, string) {
	cfg, errs := parseCommon(b.PrivateKey, b.DNS, b.Endpoint, b.KeepAlive)
	if len(errs) > 0 {
		return types.ValidatedConfig{}, strings.Join(errs, ", ")
	}
	return cfg, ""
}

func originGuard(c fiber.Ctx) error {
	host := c.Hostname()
	origin := c.Get("Origin")
	referer := c.Get("Referer")

	if origin != "" {
		cleanOrg := origin
		if strings.HasPrefix(cleanOrg, "https://") {
			cleanOrg = cleanOrg[8:]
		} else if strings.HasPrefix(cleanOrg, "http://") {
			cleanOrg = cleanOrg[7:]
		}
		if cleanOrg != host && !strings.HasPrefix(cleanOrg, host+":") {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden Origin"})
		}
	}

	if referer != "" {
		if !strings.Contains(referer, host) {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden Referer"})
		}
	}

	return c.Next()
}

func serveAsset(c fiber.Ctx, asset *types.Asset, cacheTier string) error {
	if c.Get("if-none-match") == asset.Etag {
		return c.SendStatus(304)
	}

	c.Set("ETag", asset.Etag)
	c.Set("Content-Type", asset.Mime)
	c.Set("Cache-Control", cacheTier)

	if asset.Brotli != nil && strings.Contains(c.Get("accept-encoding"), "br") {
		c.Set("Content-Encoding", "br")
		return c.Send(asset.Brotli)
	}
	return c.Send(asset.Content)
}

func buildBatchPath(batchCountry, batchCity string, srv types.ProcessedServer) string {
	if batchCountry == "" {
		size := len(srv.Country) + len(srv.City) + len(srv.FileName) + 2
		buf := make([]byte, 0, size)
		buf = append(buf, srv.Country...)
		buf = append(buf, '/')
		buf = append(buf, srv.City...)
		buf = append(buf, '/')
		buf = append(buf, srv.FileName...)
		return string(buf)
	}
	if batchCity == "" {
		size := len(srv.City) + len(srv.FileName) + 1
		buf := make([]byte, 0, size)
		buf = append(buf, srv.City...)
		buf = append(buf, '/')
		buf = append(buf, srv.FileName...)
		return string(buf)
	}
	return srv.FileName
}

func sanitizeFilename(s string) string {
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' {
			b = append(b, c)
		} else if c == ' ' {
			b = append(b, '_')
		}
	}
	return string(b)
}

func buildBaseName(country, city string) string {
	if country == "" {
		return "NordVPN_All"
	}
	sc := sanitizeFilename(country)
	if city == "" {
		buf := make([]byte, 0, 8+len(sc))
		buf = append(buf, "NordVPN_"...)
		buf = append(buf, sc...)
		return string(buf)
	}
	scity := sanitizeFilename(city)
	buf := make([]byte, 0, 9+len(sc)+len(scity))
	buf = append(buf, "NordVPN_"...)
	buf = append(buf, sc...)
	buf = append(buf, '_')
	buf = append(buf, scity...)
	return string(buf)
}

func buildDisposition(name string) string {
	buf := make([]byte, 0, 24+len(name))
	buf = append(buf, `attachment; filename="`...)
	buf = append(buf, name...)
	buf = append(buf, `.nord"`...)
	return string(buf)
}

func buildConfDisposition(code, num string) string {
	buf := make([]byte, 0, 24+len(code)+len(num)+5)
	buf = append(buf, `attachment; filename="`...)
	buf = append(buf, code...)
	buf = append(buf, num...)
	buf = append(buf, `.conf"`...)
	return string(buf)
}

func dedup(path string, usedPaths map[string]int) string {
	val, exists := usedPaths[path]
	if !exists {
		usedPaths[path] = 0
		return path
	}

	base := path[:len(path)-5]
	idx := val
	if idx == 0 {
		idx = 1
	}

	baseBuf := make([]byte, 0, len(base)+12)
	baseBuf = append(baseBuf, base...)
	baseBuf = append(baseBuf, '_')
	prefixLen := len(baseBuf)

	for {
		baseBuf = baseBuf[:prefixLen]
		baseBuf = strconv.AppendInt(baseBuf, int64(idx), 10)
		baseBuf = append(baseBuf, '.', 'c', 'o', 'n', 'f')
		candidate := string(baseBuf)
		idx++
		if _, occupied := usedPaths[candidate]; !occupied {
			usedPaths[path] = idx
			usedPaths[candidate] = 0
			return candidate
		}
	}
}

func main() {
	store.Core.Init()

	app := fiber.New(fiber.Config{
		BodyLimit:    4 * 1024 * 1024,
		ProxyHeader:  "X-Forwarded-For",
		JSONEncoder:  sonic.Marshal,
		JSONDecoder:  sonic.Unmarshal,
		ErrorHandler: nil,
	})

	app.Use(cors.New())

	api := app.Group("/api")
	api.Use(originGuard)

	stdLimiter := limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c fiber.Ctx) string {
			return c.IP()
		},
	})

	heavyLimiter := limiter.New(limiter.Config{
		Max:        5,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c fiber.Ctx) error {
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded for batch generation"})
		},
	})

	api.Get("/servers", stdLimiter, func(c fiber.Ctx) error {
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

	api.Post("/key", stdLimiter, func(c fiber.Ctx) error {
		var body struct {
			Token string `json:"token"`
		}
		if err := sonic.Unmarshal(c.Body(), &body); err != nil {
			return c.SendStatus(400)
		}

		if !isHex(body.Token) {
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

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return c.SendStatus(500)
		}

		var data struct {
			Key string `json:"nordlynx_private_key"`
		}
		if sonic.Unmarshal(respBody, &data) != nil {
			return c.SendStatus(500)
		}

		return c.JSON(fiber.Map{"key": data.Key})
	})

	handleConfig := func(c fiber.Ctx, outputType string) error {
		var body types.ConfigRequest
		if err := sonic.Unmarshal(c.Body(), &body); err != nil {
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

		c.Set("Cache-Control", "no-store")

		if outputType == "text" {
			return c.Send(wg.Build(srv, pk, cfg))
		}

		if outputType == "file" {
			c.Set("Content-Disposition", buildConfDisposition(srv.LowCode, srv.Number))
			c.Set("Content-Type", "application/x-wireguard-config")
			return c.Send(wg.Build(srv, pk, cfg))
		}

		png, err := qrcode.Encode(string(wg.Build(srv, pk, cfg)), qrcode.Medium, 256)
		if err != nil {
			return c.SendStatus(500)
		}
		c.Set("Content-Type", "image/png")
		return c.Send(png)
	}

	api.Post("/config", stdLimiter, func(c fiber.Ctx) error { return handleConfig(c, "text") })
	api.Post("/config/download", stdLimiter, func(c fiber.Ctx) error { return handleConfig(c, "file") })
	api.Post("/config/qr", stdLimiter, func(c fiber.Ctx) error { return handleConfig(c, "qr") })

	api.Post("/config/batch", heavyLimiter, func(c fiber.Ctx) error {
		var body types.BatchConfigReq
		if err := sonic.Unmarshal(c.Body(), &body); err != nil {
			return c.SendStatus(400)
		}

		cfg, errMsg := validateBatch(body)
		if errMsg != "" {
			return c.Status(400).JSON(fiber.Map{"error": errMsg})
		}

		servers := store.Core.GetBatch(body.Country, body.City)
		if len(servers) == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "No servers found"})
		}

		baseName := buildBaseName(body.Country, body.City)

		c.Set("Content-Type", "application/octet-stream")
		c.Set("Content-Disposition", buildDisposition(baseName))
		c.Set("Cache-Control", "no-store")

		c.RequestCtx().SetBodyStreamWriter(func(w *bufio.Writer) {
			zw := zip.NewWriter(w)
			defer zw.Close()

			usedPaths := make(map[string]int, len(servers))

			for _, srv := range servers {
				pk, ok := store.Core.GetKey(srv.KeyID)
				if !ok {
					continue
				}

				path := buildBatchPath(body.Country, body.City, srv)
				path = dedup(path, usedPaths)

				f, err := zw.CreateHeader(&zip.FileHeader{
					Name:   path,
					Method: zip.Store,
				})
				if err != nil {
					continue
				}

				wg.WriteConfig(f, srv, pk, cfg)
			}
		})

		return nil
	})

	app.Use(func(c fiber.Ctx) error {
		path := c.Path()
		asset := store.Core.GetAsset(path)

		if asset == nil {
			if strings.HasPrefix(path, "/api") {
				return c.Status(404).JSON(fiber.Map{"message": "Endpoint not found"})
			}
			asset = store.Core.GetAsset("/")
			if asset != nil {
				return serveAsset(c, asset, "public, max-age=300")
			}
			return c.SendStatus(404)
		}

		cc := "public, max-age=300"
		if strings.HasPrefix(path, "/assets") {
			cc = "public, max-age=31536000, immutable"
		}

		return serveAsset(c, asset, cc)
	})

	app.Listen(":3000")
}
