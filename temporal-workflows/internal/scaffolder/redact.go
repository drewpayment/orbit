// Package-level text redaction for engine-produced strings.
//
// It lives here rather than in the activities package because BOTH the
// workflow (which composes plan descriptions from activity errors) and the
// dispatch activities (which persist step errors and outputs) have to scrub
// the same text with the same rules.
package scaffolder

import "regexp"

// RedactedPlaceholder replaces a credential-shaped value.
const RedactedPlaceholder = "[redacted]"

// Credential shapes recognised in free text.
//
// This is a BACKSTOP for text this code did not compose (an action's error
// string). The real control is not putting secrets in messages; the run log
// only ever carries step lifecycle lines, never a resolved input.
//
// It is tuned for precision over recall, because over-redaction actively
// misleads: "Secret: [redacted] not found" tells an operator less than the
// unredacted message did. So a field name only counts when it means "the
// value IS a credential". Deliberately absent as standalone names: `secret`,
// `token`, `credential`, `auth`, `private_key` — those routinely name a
// resource (a Kubernetes Secret, a git ref like `token: refs/heads/x`, a key
// file path), and matching them destroyed the identifying half of real
// messages. They ARE matched as a suffix (`webhook_secret`, `npm_token`),
// which is unambiguous.
var (
	// secretValueChars: no whitespace or quoting, and no brackets, so
	// re-running cannot chew an earlier "[redacted]".
	secretValueChars = `[^\s"'&,;)\[\]{}]`

	// credentialValue requires the value to contain a DIGIT.
	//
	// A credential-ish field name is a strong signal but not a sufficient one:
	// `api_secret: orbit-shared-secret`, `image-pull-secret: my-registry-creds`
	// and `repo_token: refs/heads/main` all name resources, and scrubbing the
	// name destroys the identifying half of the message. Real credentials
	// carry digits, so this keeps recall where it matters while leaving
	// resource names intact.
	//
	// It also removes the backtracking hazard for free: an auth scheme word
	// ("Bearer", "Basic") has no digit, so it can never be matched AS the
	// value and published along with the token after it.
	//
	// Accepted cost: a purely alphabetic secret is not matched by name. Those
	// are still caught by shape when they carry a provider prefix, and the
	// real control is keeping secrets out of messages at all.
	credentialValue = `(` + secretValueChars + `*[0-9]` + secretValueChars + `*)`

	// pemPrivateKeyPattern matches a whole PEM private key block, which no
	// field-name rule would catch since the key body has no name attached.
	pemPrivateKeyPattern = regexp.MustCompile(
		`(?s)-----BEGIN[A-Z ]*PRIVATE KEY-----.*?-----END[A-Z ]*PRIVATE KEY-----`)

	// pemTruncatedPattern catches a key body whose END line was cut off — a
	// log line clipped at a length limit, say. It is applied only after the
	// complete-block rule, so a well-formed key never reaches it.
	pemTruncatedPattern = regexp.MustCompile(
		`-----BEGIN[A-Z ]*PRIVATE KEY-----[\sA-Za-z0-9+/=]*`)

	// urlUserinfoPattern matches the password half of scheme://user:pass@host.
	// Group 1 keeps everything up to and including the ":", group 2 is the
	// password, and the trailing "@host" is restored by the replacement. The
	// password class allows "/" because base64 credentials contain it, but
	// stops at "?" and "#" as well as "@" — otherwise a URL with a port and an
	// email in its query string (https://gateway:8443/api?owner=a@corp.com)
	// would be treated as userinfo and mangled.
	urlUserinfoPattern = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@]+:)([^\s@?#]+)@`)

	// secretAssignmentPattern matches `<credential name> = <value>`, including
	// a leading auth scheme ("Bearer", "Basic", "token") which must be KEPT —
	// eating the scheme while publishing the token after it is worse than not
	// redacting at all.
	secretAssignmentPattern = regexp.MustCompile(
		`(?i)\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|bearer[_-]?token|api[_-]?key|apikey|api[_-]?secret|client[_-]?secret|password|passwd|pwd|authorization)` +
			`["']?\s*[=:]\s*["']?(?:(?:bearer|basic|token)\s+)?)` + credentialValue)

	// secretSuffixAssignmentPattern matches a qualified credential name:
	// webhook_secret, npm_token, GITHUB-TOKEN, db_password. The required prefix
	// segment is what keeps it off a bare "Secret:" or "token: refs/heads/x".
	//
	// `key` is deliberately NOT a suffix here: private_key, ssh_key and
	// host_key name files at least as often as they name secrets, and matching
	// them scrubbed the path an operator needs.
	secretSuffixAssignmentPattern = regexp.MustCompile(
		`(?i)\b([a-z0-9]+[_-](?:secret|token|password)["']?\s*[=:]\s*["']?(?:(?:bearer|basic|token)\s+)?)` +
			credentialValue)

	// secretTokenPattern matches tokens that identify themselves, so they are
	// redacted wherever they appear regardless of any surrounding field name:
	// GitHub (classic ghp_/gho_/ghu_/ghs_/ghr_ and fine-grained github_pat_),
	// GitLab (glpat-), Slack (xoxb-/xoxp-/xoxa-/xoxs-), AWS access key ids,
	// and long opaque alphanumeric strings shaped like an Azure DevOps PAT.
	//
	// The opaque rule starts at 40 characters, which alone would swallow git
	// SHAs and sha256/sha512 digests — so redactSecretsInText skips any
	// candidate that is pure hexadecimal. Digests and commit ids are therefore
	// preserved, while a mixed-case opaque PAT is not.
	secretTokenPattern = regexp.MustCompile(
		`\b(gh[pousr]_[A-Za-z0-9]{16,}` +
			`|github_pat_[A-Za-z0-9_]{20,}` +
			`|glpat-[A-Za-z0-9\-_]{16,}` +
			`|xox[baps]-[A-Za-z0-9\-]{10,}` +
			`|AKIA[0-9A-Z]{16}` +
			`|[A-Za-z0-9]{40,})\b`)

	// hexOnlyPattern identifies a candidate that is a digest or commit id
	// rather than a credential.
	hexOnlyPattern = regexp.MustCompile(`^[0-9a-fA-F]+$`)
)

// RedactText scrubs credential-shaped substrings from free text.
//
// Only the value is replaced, so the reader still sees which field leaked and
// what the surrounding error said. Running it twice is a no-op.
func RedactText(s string) string {
	if s == "" {
		return s
	}
	// Whole-block rules first, then the most specific field rules, then the
	// self-identifying token shapes. URL userinfo precedes the assignment
	// rules so a credentialed clone URL keeps its host.
	out := pemPrivateKeyPattern.ReplaceAllString(s, RedactedPlaceholder)
	out = pemTruncatedPattern.ReplaceAllString(out, RedactedPlaceholder)
	out = urlUserinfoPattern.ReplaceAllString(out, "${1}"+RedactedPlaceholder+"@")
	out = secretSuffixAssignmentPattern.ReplaceAllString(out, "${1}"+RedactedPlaceholder)
	out = secretAssignmentPattern.ReplaceAllString(out, "${1}"+RedactedPlaceholder)
	return secretTokenPattern.ReplaceAllStringFunc(out, func(match string) string {
		// A pure-hex run of this length is a digest or a commit id, not a
		// credential. Redacting it would destroy the most useful part of a
		// git or registry error.
		if hexOnlyPattern.MatchString(match) {
			return match
		}
		return RedactedPlaceholder
	})
}
