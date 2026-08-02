package models

import "testing"

func TestUserPreferencesValidate(t *testing.T) {
	tests := []struct {
		name    string
		prefs   UserPreferences
		wantErr bool
	}{
		{name: "IPv4", prefs: UserPreferences{DNS: "1.1.1.1", Keepalive: 25}},
		{name: "IPv6", prefs: UserPreferences{DNS: "2606:4700:4700::1111", Keepalive: 0}},
		{name: "trimmed", prefs: UserPreferences{DNS: " 1.1.1.1 ", Keepalive: MaxKeepalive}},
		{name: "invalid DNS", prefs: UserPreferences{DNS: "dns.example", Keepalive: 25}, wantErr: true},
		{name: "negative keepalive", prefs: UserPreferences{DNS: "1.1.1.1", Keepalive: -1}, wantErr: true},
		{name: "excessive keepalive", prefs: UserPreferences{DNS: "1.1.1.1", Keepalive: MaxKeepalive + 1}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.prefs.Validate()
			if (err != nil) != test.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}
