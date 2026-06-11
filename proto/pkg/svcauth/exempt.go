package svcauth

import "strings"

// exemptMethods is the explicit allowlist of fully-qualified methods/procedures
// that bypass authentication. The default for everything else is DENY. Only
// liveness/health probes and (dev-only) server reflection are exempt — never a
// business RPC.
//
// Both the gRPC FullMethod ("/pkg.Service/Method") and Connect procedure
// ("/pkg.Service/Method") share this slash-delimited form, so one matcher
// serves both interceptors.
var exemptMethods = map[string]struct{}{
	"/grpc.health.v1.Health/Check": {},
	"/grpc.health.v1.Health/Watch": {},
}

// exemptPrefixes covers method families where matching every method by name is
// brittle — currently only gRPC server reflection (dev-only) and the Connect
// HealthService probe family.
var exemptPrefixes = []string{
	"/grpc.reflection.",
	"/idp.health.v1.HealthService/",
}

// isExempt reports whether the given fully-qualified method/procedure may skip
// token verification.
func isExempt(fullMethod string) bool {
	if _, ok := exemptMethods[fullMethod]; ok {
		return true
	}
	for _, p := range exemptPrefixes {
		if strings.HasPrefix(fullMethod, p) {
			return true
		}
	}
	return false
}

// bearerFrom extracts the raw JWT from one or more "authorization" header
// values, expecting the "Bearer <token>" scheme. It returns "" when no usable
// bearer value is present, which ParseAndVerify then rejects.
func bearerFrom(values []string) string {
	const prefix = "Bearer "
	for _, v := range values {
		if len(v) > len(prefix) && strings.EqualFold(v[:len(prefix)], prefix) {
			return strings.TrimSpace(v[len(prefix):])
		}
	}
	return ""
}
