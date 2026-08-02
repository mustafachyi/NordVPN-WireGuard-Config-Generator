package wireguard

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(fill byte) string {
	value := make([]byte, 32)
	for index := range value {
		value[index] = fill
	}
	return base64.StdEncoding.EncodeToString(value)
}

func TestValidateKey(t *testing.T) {
	if err := ValidateKey(testKey(1)); err != nil {
		t.Fatalf("ValidateKey(valid) error = %v", err)
	}
	for _, value := range []string{"", "not-base64", base64.StdEncoding.EncodeToString(make([]byte, 31))} {
		if err := ValidateKey(value); err == nil {
			t.Fatalf("ValidateKey(%q) succeeded", value)
		}
	}
}

func TestValidateEndpoint(t *testing.T) {
	valid := []string{"us123.nordvpn.com", "1.2.3.4", "2001:db8::1", "a-b.example.com"}
	for _, value := range valid {
		if err := ValidateEndpoint(value); err != nil {
			t.Errorf("ValidateEndpoint(%q) error = %v", value, err)
		}
	}
	invalid := []string{"", "localhost", "bad host.example", "-bad.example", "bad-.example", "bad..example", "bad.example.", "bad_example.com", "example\n.com"}
	for _, value := range invalid {
		if err := ValidateEndpoint(value); err == nil {
			t.Errorf("ValidateEndpoint(%q) succeeded", value)
		}
	}
}

func TestBuildConfig(t *testing.T) {
	privateKey := testKey(1)
	publicKey := testKey(2)
	content, err := BuildConfig(privateKey, publicKey, " 2001:db8::1 ", " 1.1.1.1 ", 25)
	if err != nil {
		t.Fatalf("BuildConfig() error = %v", err)
	}
	text := string(content)
	checks := []string{
		"PrivateKey = " + privateKey,
		"PublicKey = " + publicKey,
		"DNS = 1.1.1.1",
		"Endpoint = [2001:db8::1]:51820",
		"PersistentKeepalive = 25\n",
	}
	for _, check := range checks {
		if !strings.Contains(text, check) {
			t.Errorf("configuration missing %q", check)
		}
	}
}

func TestBuildConfigRejectsInvalidValues(t *testing.T) {
	privateKey := testKey(1)
	publicKey := testKey(2)
	tests := []struct {
		name       string
		privateKey string
		publicKey  string
		endpoint   string
		dns        string
		keepalive  int
	}{
		{name: "private key", privateKey: "bad", publicKey: publicKey, endpoint: "us1.example.com", dns: "1.1.1.1", keepalive: 25},
		{name: "public key", privateKey: privateKey, publicKey: "bad", endpoint: "us1.example.com", dns: "1.1.1.1", keepalive: 25},
		{name: "endpoint", privateKey: privateKey, publicKey: publicKey, endpoint: "bad endpoint", dns: "1.1.1.1", keepalive: 25},
		{name: "DNS", privateKey: privateKey, publicKey: publicKey, endpoint: "us1.example.com", dns: "bad", keepalive: 25},
		{name: "keepalive", privateKey: privateKey, publicKey: publicKey, endpoint: "us1.example.com", dns: "1.1.1.1", keepalive: 65536},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := BuildConfig(test.privateKey, test.publicKey, test.endpoint, test.dns, test.keepalive); err == nil {
				t.Fatal("BuildConfig() succeeded")
			}
		})
	}
}
