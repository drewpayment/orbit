package apache

import (
	"testing"
)

// validTestCACert is a self-signed CA certificate for testing purposes only.
// Generated with: openssl req -x509 -newkey rsa:2048 -keyout /dev/null -out /dev/stdout -days 365 -nodes -subj "/CN=test"
const validTestCACert = `-----BEGIN CERTIFICATE-----
MIIC/zCCAeegAwIBAgIURE6PJWUtBQ+NcZ4q4XOPClieuyQwDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwEdGVzdDAeFw0yNjAxMTYwMDQ3NTdaFw0yNzAxMTYwMDQ3
NTdaMA8xDTALBgNVBAMMBHRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQC2W4JDethSPNQh/1fdeyhz8MGl1GZBG/h9SXw6hpkxhPgc8WbG0Cfnw/GH
fJseJkpOi7uprogCODPhUjPhBMMITQzVVKUCg/QjG0cisqYKJCp2Hg0oHDzPnX1S
I1TjbRcYnswIHQzUZfEiIXuLzR0ycAZB0Rx1SeTLXBW2d8n/gvFIna8aHjh5a/iW
ayv2/lE/Pz2z5Axc7IVv8gKyNH1WBFhVyZB77mKAOBbSNL+kKBjFivmMEV29gXjj
EJbK9QxGKiat0o80qKsBJTzpERUI1uh2XFoy5j9XR1TDlPRl8rGvfA4tYkIJkMi2
44Uhe9RGnbV/FXkOqa+M45kJ45PtAgMBAAGjUzBRMB0GA1UdDgQWBBRSJo+YfZ8+
7wgvV8m3yCZ06QhYSDAfBgNVHSMEGDAWgBRSJo+YfZ8+7wgvV8m3yCZ06QhYSDAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQB8MVFh4OFTbxrIq8aT
Z97q41gmwXM2cjHyMiChScOSYpa2HyH03KGXwozJJuZc0LDsjeqMFpmwpOUyVqwE
qAkUOfeptIQTJt+GjY6mwQCDnmcbEa4GjJgXOdw4esWfKK1IA5LM6yiyU9zfj1Ab
7tdDnGw2KXpgLlp3+znNVi5lV9c6pTrpJxq39ZXMjgQdZidkfRaVat5n6Pic1+IM
Y7wgLrOlvqFHkNZGrn34uS6RWwbshT63rwhPijLseRmUHcjnTomD8Zgh2uJedocE
LVbb2rok0brGX1Y5G7gimaOr353GRauMGsbZtdJurG1I8uenZVIPl12a0FD5yrZx
ZY2Z
-----END CERTIFICATE-----`

func TestBuildSASLMechanism(t *testing.T) {
	tests := []struct {
		name      string
		mechanism string
		username  string
		password  string
		wantNil   bool
		wantErr   bool
	}{
		{
			name:      "PLAIN mechanism",
			mechanism: "PLAIN",
			username:  "user",
			password:  "pass",
			wantNil:   false,
			wantErr:   false,
		},
		{
			name:      "SCRAM-SHA-256 mechanism",
			mechanism: "SCRAM-SHA-256",
			username:  "user",
			password:  "pass",
			wantNil:   false,
			wantErr:   false,
		},
		{
			name:      "SCRAM-SHA-512 mechanism",
			mechanism: "SCRAM-SHA-512",
			username:  "user",
			password:  "pass",
			wantNil:   false,
			wantErr:   false,
		},
		{
			name:      "empty mechanism returns nil",
			mechanism: "",
			username:  "user",
			password:  "pass",
			wantNil:   true,
			wantErr:   false,
		},
		{
			name:      "empty username returns nil",
			mechanism: "PLAIN",
			username:  "",
			password:  "pass",
			wantNil:   true,
			wantErr:   false,
		},
		{
			name:      "unsupported mechanism returns error",
			mechanism: "OAUTHBEARER",
			username:  "user",
			password:  "pass",
			wantNil:   true,
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mechanism, err := buildSASLMechanism(tt.mechanism, tt.username, tt.password)

			if (err != nil) != tt.wantErr {
				t.Errorf("buildSASLMechanism() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if (mechanism == nil) != tt.wantNil {
				t.Errorf("buildSASLMechanism() mechanism nil = %v, wantNil %v", mechanism == nil, tt.wantNil)
			}
		})
	}
}

func TestBuildTLSConfig(t *testing.T) {
	tests := []struct {
		name           string
		tlsEnabled     bool
		tlsSkipVerify  bool
		tlsCACert      string
		wantNil        bool
		wantSkipVerify bool
		wantErr        bool
	}{
		{
			name:       "TLS disabled returns nil",
			tlsEnabled: false,
			wantNil:    true,
			wantErr:    false,
		},
		{
			name:           "TLS enabled with skip verify",
			tlsEnabled:     true,
			tlsSkipVerify:  true,
			wantNil:        false,
			wantSkipVerify: true,
			wantErr:        false,
		},
		{
			name:           "TLS enabled without skip verify",
			tlsEnabled:     true,
			tlsSkipVerify:  false,
			wantNil:        false,
			wantSkipVerify: false,
			wantErr:        false,
		},
		{
			name:       "TLS with valid CA cert",
			tlsEnabled: true,
			tlsCACert:  validTestCACert,
			wantNil:    false,
			wantErr:    false,
		},
		{
			name:       "TLS with invalid CA cert returns error",
			tlsEnabled: true,
			tlsCACert:  "not a valid cert",
			wantNil:    true,
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tlsConfig, err := buildTLSConfig(tt.tlsEnabled, tt.tlsSkipVerify, tt.tlsCACert)

			if (err != nil) != tt.wantErr {
				t.Errorf("buildTLSConfig() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if (tlsConfig == nil) != tt.wantNil {
				t.Errorf("buildTLSConfig() tlsConfig nil = %v, wantNil %v", tlsConfig == nil, tt.wantNil)
				return
			}

			if tlsConfig != nil && tlsConfig.InsecureSkipVerify != tt.wantSkipVerify {
				t.Errorf("buildTLSConfig() InsecureSkipVerify = %v, want %v", tlsConfig.InsecureSkipVerify, tt.wantSkipVerify)
			}
		})
	}
}

func TestShouldEnableTLS(t *testing.T) {
	tests := []struct {
		name             string
		tlsEnabled       bool
		securityProtocol string
		want             bool
	}{
		{
			name:             "explicitly enabled",
			tlsEnabled:       true,
			securityProtocol: "",
			want:             true,
		},
		{
			name:             "SASL_SSL protocol",
			tlsEnabled:       false,
			securityProtocol: "SASL_SSL",
			want:             true,
		},
		{
			name:             "SSL protocol",
			tlsEnabled:       false,
			securityProtocol: "SSL",
			want:             true,
		},
		{
			name:             "PLAINTEXT protocol",
			tlsEnabled:       false,
			securityProtocol: "PLAINTEXT",
			want:             false,
		},
		{
			name:             "SASL_PLAINTEXT protocol",
			tlsEnabled:       false,
			securityProtocol: "SASL_PLAINTEXT",
			want:             false,
		},
		{
			name:             "empty protocol, not enabled",
			tlsEnabled:       false,
			securityProtocol: "",
			want:             false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldEnableTLS(tt.tlsEnabled, tt.securityProtocol)
			if got != tt.want {
				t.Errorf("shouldEnableTLS() = %v, want %v", got, tt.want)
			}
		})
	}
}
