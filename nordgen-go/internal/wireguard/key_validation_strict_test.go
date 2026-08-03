package wireguard

import (
	"encoding/base64"
	"testing"
)

func strictValidationTestKey(fill byte) string {
	value := make([]byte, 32)
	for index := range value {
		value[index] = fill
	}
	return base64.StdEncoding.EncodeToString(value)
}

func TestValidateKeyRejectsNonLexicalBase64(t *testing.T) {
	valid := strictValidationTestKey(1)
	invalid := []string{
		valid[:20] + "\n" + valid[20:],
		valid[:20] + "\r" + valid[20:],
		valid[:20] + "\t" + valid[20:],
		" " + valid[1:],
		"-" + valid[1:],
		valid[:42] + "==",
		valid[:43] + "A",
	}

	for _, value := range invalid {
		if err := ValidateKey(value); err == nil {
			t.Errorf("ValidateKey(%q) succeeded", value)
		}
	}
}
