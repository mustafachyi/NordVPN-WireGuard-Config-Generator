package wireguard

import (
	"encoding/base64"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
)

const (
	endpointPort              = 51820
	wireGuardKeyEncodedLength = 44
)

func ValidateKey(value string) error {
	if len(value) != wireGuardKeyEncodedLength || value[wireGuardKeyEncodedLength-1] != '=' {
		return fmt.Errorf("key must be a base64-encoded 32-byte value")
	}

	for index := 0; index < wireGuardKeyEncodedLength-1; index++ {
		character := value[index]
		if (character >= 'A' && character <= 'Z') ||
			(character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') ||
			character == '+' || character == '/' {
			continue
		}
		return fmt.Errorf("key must be a base64-encoded 32-byte value")
	}

	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return fmt.Errorf("key must be a base64-encoded 32-byte value")
	}
	return nil
}

func ValidateEndpoint(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("endpoint is empty")
	}
	if strings.ContainsAny(value, "\r\n\t ") {
		return fmt.Errorf("endpoint contains whitespace")
	}
	if _, err := netip.ParseAddr(value); err == nil {
		return nil
	}
	if len(value) > 253 || strings.HasSuffix(value, ".") {
		return fmt.Errorf("endpoint hostname is invalid")
	}
	labels := strings.Split(value, ".")
	if len(labels) < 2 {
		return fmt.Errorf("endpoint hostname is invalid")
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return fmt.Errorf("endpoint hostname is invalid")
		}
		for index := 0; index < len(label); index++ {
			character := label[index]
			if (character >= 'a' && character <= 'z') ||
				(character >= 'A' && character <= 'Z') ||
				(character >= '0' && character <= '9') ||
				character == '-' {
				continue
			}
			return fmt.Errorf("endpoint hostname is invalid")
		}
	}
	return nil
}

func BuildConfig(privateKey, publicKey, endpoint, dns string, keepalive int) ([]byte, error) {
	if err := ValidateKey(privateKey); err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}
	if err := ValidateKey(publicKey); err != nil {
		return nil, fmt.Errorf("invalid public key: %w", err)
	}
	endpoint = strings.TrimSpace(endpoint)
	if err := ValidateEndpoint(endpoint); err != nil {
		return nil, fmt.Errorf("invalid endpoint: %w", err)
	}
	dnsAddr, err := netip.ParseAddr(strings.TrimSpace(dns))
	if err != nil {
		return nil, fmt.Errorf("invalid DNS address")
	}
	if keepalive < 0 || keepalive > 65535 {
		return nil, fmt.Errorf("keepalive must be between 0 and 65535 seconds")
	}

	host := endpoint
	if addr, parseErr := netip.ParseAddr(endpoint); parseErr == nil {
		host = addr.String()
		if addr.Is6() {
			host = "[" + host + "]"
		}
	}

	var builder strings.Builder
	builder.Grow(256)
	builder.WriteString("[Interface]\nPrivateKey = ")
	builder.WriteString(privateKey)
	builder.WriteString("\nAddress = 10.5.0.2/16\nDNS = ")
	builder.WriteString(dnsAddr.String())
	builder.WriteString("\n\n[Peer]\nPublicKey = ")
	builder.WriteString(publicKey)
	builder.WriteString("\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = ")
	builder.WriteString(host)
	builder.WriteByte(':')
	builder.WriteString(strconv.Itoa(endpointPort))
	builder.WriteString("\nPersistentKeepalive = ")
	builder.WriteString(strconv.Itoa(keepalive))
	builder.WriteByte('\n')

	return []byte(builder.String()), nil
}
