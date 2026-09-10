package scaffolder

// The redaction table lives next to the implementation it exercises. It used
// to sit in the activities package, which is how the rules came to exist in
// two copies without anyone noticing that improvements were landing in only
// one of them.

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRedactText(t *testing.T) {
	const ghToken = "ghp_abcdefghij0123456789"

	tests := []struct {
		name string
		in   string
		// mustNotContain is the secret that has to disappear.
		mustNotContain string
		// mustContain are fragments that must survive, so a redacted message
		// stays diagnosable.
		mustContain []string
		// unchanged asserts the input is returned verbatim — the assertion
		// that catches over-redaction.
		unchanged bool
	}{
		// --- must not be touched: these name a resource, not a secret ------
		{name: "ordinary error", in: "clone failed: repository not found", unchanged: true},
		{name: "empty string", in: "", unchanged: true},
		{
			name:      "kubernetes Secret by name",
			in:        "Secret: orbit-git-credentials not found in namespace orbit",
			unchanged: true,
		},
		{name: "a git ref under the word token", in: "token: refs/heads/feature-branch is protected", unchanged: true},
		{name: "a key file path", in: "private_key: /etc/orbit/id_ed25519 has bad permissions", unchanged: true},
		{name: "a credentials file path", in: "credential: /home/runner/.git-credentials is unreadable", unchanged: true},
		{name: "an auth diagnostic", in: "auth: could-not-reach-provider after 3 attempts", unchanged: true},
		{name: "a git SHA-1 is not a token", in: "at commit 0123456789abcdef0123456789abcdef01234567", unchanged: true},

		// --- must be redacted ----------------------------------------------
		{
			name:           "keeps the Bearer scheme, redacts the token",
			in:             "Authorization: Bearer " + ghToken + " rejected",
			mustNotContain: ghToken,
			mustContain:    []string{"Authorization:", "Bearer", "rejected"},
		},
		{
			name:           "keeps the Basic scheme",
			in:             "authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1",
			mustNotContain: "dXNlcjpwYXNzd29yZDEyMzQ1",
			mustContain:    []string{"Basic"},
		},
		{
			name:           "keeps the host in an x-access-token clone URL",
			in:             "clone https://x-access-token:" + ghToken + "@github.com/acme/svc.git failed",
			mustNotContain: ghToken,
			mustContain:    []string{"github.com/acme/svc.git", "x-access-token", "failed"},
		},
		{
			name:           "redacts a plain user:password clone URL",
			in:             "clone https://svcuser:S3cr3tP4ss@github.com/acme/svc.git failed",
			mustNotContain: "S3cr3tP4ss",
			mustContain:    []string{"svcuser", "github.com/acme/svc.git"},
		},
		{
			name:           "redacts userinfo in a remote error",
			in:             "remote: Invalid username or password for 'https://bob:LongPasswordHere123@git.example.com'",
			mustNotContain: "LongPasswordHere123",
			mustContain:    []string{"bob", "git.example.com"},
		},
		{
			name:           "scrubs a token query parameter, keeps the path",
			in:             "GET https://api.example.com/repos?access_token=" + ghToken + " -> 401",
			mustNotContain: ghToken,
			mustContain:    []string{"api.example.com/repos", "401"},
		},
		{
			// The @-in-value case: excluding @ from the value class used to
			// make this match nothing at all, redacting less than before.
			name:           "scrubs a password containing an at sign",
			in:             "password=p@ssw0rd123456 rejected",
			mustNotContain: "p@ssw0rd123456",
			mustContain:    []string{"rejected"},
		},
		{
			name:           "scrubs a quoted password",
			in:             `password: "hunter2hunter2"`,
			mustNotContain: "hunter2hunter2",
		},
		{name: "scrubs an api key", in: "apiKey=sk-live-0123456789", mustNotContain: "sk-live-0123456789"},
		{name: "scrubs a client secret", in: "client_secret=abc123def456ghi789", mustNotContain: "abc123def456ghi789"},
		{
			name:           "scrubs a fine-grained github pat",
			in:             "auth failed for github_pat_11ABCDEFG0abcdefghijklmnop",
			mustNotContain: "github_pat_11ABCDEFG0abcdefghijklmnop",
		},
		{name: "scrubs a gitlab pat", in: "push rejected: glpat-ABCDEFGHIJ0123456789", mustNotContain: "glpat-ABCDEFGHIJ0123456789"},
		{name: "scrubs a slack bot token", in: "slack said no to xoxb-123456789012-abcdefghij", mustNotContain: "xoxb-123456789012-abcdefghij"},
		{name: "scrubs an aws access key id", in: "using AKIAIOSFODNN7EXAMPLE", mustNotContain: "AKIAIOSFODNN7EXAMPLE"},
		// --- digests and commit ids must survive ---------------------------
		{name: "a sha256 digest is not a token", in: "manifest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 not found", unchanged: true},
		{name: "a long uppercase hex digest is not a token", in: "digest E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855 mismatch", unchanged: true},
		{name: "a 40-char hex commit id is not a token", in: "reset to 0123456789abcdef0123456789abcdef0123abcd failed", unchanged: true},

		// --- suffix rule must not eat resource names (R3) -------------------
		{name: "an image pull secret by name", in: "image-pull-secret: my-registry-creds not found", unchanged: true},
		{name: "a repo token naming a git ref", in: "repo_token: refs/heads/main is protected", unchanged: true},
		{name: "a deploy token naming an environment", in: "deploy_token: staging-cluster unreachable", unchanged: true},
		{name: "an api secret naming a resource", in: "api_secret: orbit-shared-secret missing", unchanged: true},
		{name: "a bot token naming a file", in: "bot_token: /etc/orbit/creds.json unreadable", unchanged: true},

		// --- URL with a port and an email in the query (R5) -----------------
		{
			name:      "a port and an email in a query string are not userinfo",
			in:        "GET https://gateway:8443/api?owner=admin@corp.com failed",
			unchanged: true,
		},

		// --- qualified credential names (suffix rule) -----------------------
		{
			name:           "scrubs a webhook secret",
			in:             "webhook_secret=whsec_0123456789abcdef rejected",
			mustNotContain: "whsec_0123456789abcdef",
			mustContain:    []string{"webhook_secret", "rejected"},
		},
		{
			name:           "scrubs an npm token",
			in:             "npm_token=npm_0123456789abcdefghij",
			mustNotContain: "npm_0123456789abcdefghij",
		},
		{
			name:           "scrubs an upper-case github token env var",
			in:             "GITHUB_TOKEN=abcdefghij0123456789 is invalid",
			mustNotContain: "abcdefghij0123456789",
			mustContain:    []string{"GITHUB_TOKEN", "is invalid"},
		},
		{
			name:           "scrubs a hyphenated github token",
			in:             "github-token: abcdefghij0123456789",
			mustNotContain: "abcdefghij0123456789",
		},
		{
			name:           "scrubs a db password",
			in:             "db_password=p0stgr3sPassw0rd unreachable",
			mustNotContain: "p0stgr3sPassw0rd",
			mustContain:    []string{"db_password", "unreachable"},
		},

		// --- PEM blocks -----------------------------------------------------
		{
			name: "scrubs a whole PEM private key block",
			in: "deploy key rejected:\n-----BEGIN OPENSSH PRIVATE KEY-----\n" +
				"b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB\n" +
				"-----END OPENSSH PRIVATE KEY-----\nfor host github.com",
			mustNotContain: "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB",
			mustContain:    []string{"deploy key rejected", "for host github.com"},
		},
		{
			name:           "scrubs an RSA private key block",
			in:             "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz123\n-----END RSA PRIVATE KEY-----",
			mustNotContain: "MIIEowIBAAKCAQEAxyz123",
		},

		{
			name:           "scrubs a truncated PEM block with no END line (R6)",
			in:             "ssh: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz123abc456",
			mustNotContain: "MIIEowIBAAKCAQEAxyz123abc456",
			mustContain:    []string{"ssh:"},
		},

		// --- passwords containing "/" (base64) ------------------------------
		{
			name:           "scrubs a clone URL password containing a slash",
			in:             "clone https://svcuser:aB3/dEf+gh=@github.com/acme/svc.git failed",
			mustNotContain: "aB3/dEf+gh=",
			mustContain:    []string{"svcuser", "github.com/acme/svc.git"},
		},
		{
			name:           "scrubs a base64 ado pat in a clone URL",
			in:             "clone https://ado:" + strings.Repeat("aB3/", 12) + "@dev.azure.com/acme/_git/svc failed",
			mustNotContain: strings.Repeat("aB3/", 12),
			mustContain:    []string{"dev.azure.com/acme/_git/svc"},
		},
		{
			// A 52-char exact rule missed anything longer; the opaque rule is
			// now open-ended from 40, with pure-hex candidates skipped.
			name:           "scrubs a long opaque mixed-case pat",
			in:             "ado auth failed with aB3dEfGhIj0123456789aB3dEfGhIj0123456789aB3dEfGhIj0123456789",
			mustNotContain: "aB3dEfGhIj0123456789aB3dEfGhIj0123456789aB3dEfGhIj0123456789",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RedactText(tt.in)

			if tt.unchanged {
				assert.Equal(t, tt.in, got, "over-redaction: a non-secret was scrubbed")
				return
			}
			require.NotEqual(t, tt.in, got, "nothing was redacted")
			assert.NotContains(t, got, tt.mustNotContain)
			assert.Contains(t, got, RedactedPlaceholder)
			for _, frag := range tt.mustContain {
				assert.Contains(t, got, frag, "redaction destroyed a diagnosable fragment")
			}
		})
	}
}

// Redaction must be stable: running it twice must not keep chewing the text.
func TestRedactText_IsIdempotent(t *testing.T) {
	in := "Authorization: Bearer ghp_abcdefghij0123456789 rejected"
	once := RedactText(in)
	assert.Equal(t, once, RedactText(once))
}

// --- C1: a digit alone is not a credential ---------------------------------

func TestRedactText_KeepsShortNumericValues(t *testing.T) {
	// Requiring a digit put a status code right in the firing line. Redacting
	// it costs the reader the one fact that explains the error.
	tests := []string{
		"authorization: 401 from upstream",
		"access_token: 0 remaining in quota",
		"api_key: 429 rate limited, retry after 30s",
	}
	for _, in := range tests {
		t.Run(in, func(t *testing.T) {
			assert.Equal(t, in, RedactText(in), "a short numeric value is not a credential")
		})
	}
}

func TestRedactText_MinimumCredentialLength(t *testing.T) {
	// Right at the boundary, so the floor is pinned rather than incidental.
	// Total length, not padding length: the digit counts toward the floor.
	short := strings.Repeat("a", minCredentialValueLen-2) + "1" // one below
	long := strings.Repeat("a", minCredentialValueLen-1) + "1"  // exactly at it
	require.Len(t, short, minCredentialValueLen-1)
	require.Len(t, long, minCredentialValueLen)

	assert.Equal(t, "password: "+short, RedactText("password: "+short),
		"a value below the floor is left alone")
	assert.Equal(t, "password: "+RedactedPlaceholder, RedactText("password: "+long),
		"a value at the floor is redacted")
}

// --- C2: a PEM diagnostic is not a PEM key ---------------------------------

func TestRedactText_KeepsPEMDiagnosticsWithoutKeyMaterial(t *testing.T) {
	tests := []string{
		"-----BEGIN RSA PRIVATE KEY----- is malformed at line 3",
		"expected -----BEGIN OPENSSH PRIVATE KEY----- but found a certificate",
	}
	for _, in := range tests {
		t.Run(in, func(t *testing.T) {
			assert.Equal(t, in, RedactText(in),
				"a header with no key body carries no secret, only the reason")
		})
	}
}
