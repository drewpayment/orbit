// Package svcauth provides the shared service-to-service authentication core
// for Orbit's Go gRPC/Connect services. orbit-www mints a short-TTL HS256 JWT
// per outbound call; services verify it with this package and enforce tenant
// isolation via the workspace claim.
//
// See docs/plans/2026-06-10-grpc-auth-interceptor-design.md for the full design.
package svcauth

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Fixed issuer and audience strings. These are verified on every token so a
// token minted for a different system cannot be replayed against these services.
const (
	expectedIssuer   = "orbit-www"
	expectedAudience = "orbit-services"

	// minSecretBytes is the minimum acceptable length for ORBIT_SVC_AUTH_SECRET.
	// 32 bytes matches the HS256 output size; anything shorter weakens the MAC.
	minSecretBytes = 32
)

// Identity is the verified caller identity extracted from a valid token. It is
// the only trusted source of user/workspace identity inside a handler — request
// body fields (workspace_id, created_by, ...) must never be trusted over this.
type Identity struct {
	// UserID is the betterAuth user id (the JWT "sub" claim).
	UserID string
	// WorkspaceID is the workspace the caller is authorized to act in for this
	// request (the JWT "wid" claim). orbit-www only ever signs a workspace the
	// session user is a verified member of.
	WorkspaceID string
	// PlatformAdmin is true when the caller is a verified platform admin (the JWT
	// "adm" claim). orbit-www only sets it from the server-side session user role,
	// never from request input. Gate platform-scoped RPCs on this via
	// EnforcePlatformAdmin.
	PlatformAdmin bool
}

// ctxKey is an unexported type so the identity value cannot collide with or be
// overwritten by any other package's context key. Never use a bare string key.
type ctxKey struct{}

// WithIdentity returns a child context carrying the verified identity.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// IdentityFromContext returns the verified identity injected by an interceptor.
// The bool is false when no identity is present (e.g. an exempt method, or a
// handler invoked outside the interceptor chain) — callers that require identity
// must treat !ok as an authorization failure, not a default.
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(ctxKey{}).(Identity)
	return id, ok
}

// EnforceWorkspace closes GO-H2: it rejects any request whose body-supplied
// workspace id does not match the authorized workspace in the verified identity.
//
//   - bodyWorkspaceID == "" : the RPC has no workspace scope; allowed.
//   - identity missing      : not authenticated; PermissionDenied.
//   - wid == ""             : token carried no workspace; PermissionDenied
//     (a workspace-scoped RPC requires an authorized workspace).
//   - bodyWorkspaceID != wid : cross-tenant access attempt; PermissionDenied.
func EnforceWorkspace(ctx context.Context, bodyWorkspaceID string) error {
	if bodyWorkspaceID == "" {
		return nil
	}
	id, ok := IdentityFromContext(ctx)
	if !ok {
		return status.Error(codes.PermissionDenied, "no verified identity in context")
	}
	if id.WorkspaceID == "" {
		return status.Error(codes.PermissionDenied, "token has no workspace claim for a workspace-scoped request")
	}
	if bodyWorkspaceID != id.WorkspaceID {
		return status.Error(codes.PermissionDenied, "workspace_id does not match authorized workspace")
	}
	return nil
}

// EnforcePlatformAdmin gates platform-scoped RPCs (e.g. Kafka cluster
// management) that have no workspace boundary in the domain model. It requires a
// verified identity whose token carried adm=true.
//
//   - identity missing   : not authenticated; Unauthenticated.
//   - !PlatformAdmin      : authenticated but not an admin; PermissionDenied.
//
// A token minted without the "adm" claim yields PlatformAdmin=false, so such a
// token is rejected (fail closed).
func EnforcePlatformAdmin(ctx context.Context) error {
	id, ok := IdentityFromContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "no verified identity in context")
	}
	if !id.PlatformAdmin {
		return status.Error(codes.PermissionDenied, "platform admin required")
	}
	return nil
}
