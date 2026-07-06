package svcauth

import (
	"context"
	"errors"

	"connectrpc.com/connect"
)

// NewConnectInterceptor verifies the bearer token on every Connect call (for
// services on connectrpc.com/connect, i.e. repository) and injects the verified
// Identity into the handler context. It implements the full connect.Interceptor
// interface so it covers unary, client-streaming, and server-streaming handlers
// (e.g. AgentService chat) — verification runs once at stream open.
//
// enforce mirrors UnaryServerInterceptor's flag: when false, identity is still
// injected when a valid token is present but missing/invalid tokens are not
// rejected (temporary ORBIT_SVC_AUTH_ENFORCE bisect knob).
func NewConnectInterceptor(secret []byte, enforce bool) connect.Interceptor {
	return &connectInterceptor{secret: secret, enforce: enforce}
}

type connectInterceptor struct {
	secret  []byte
	enforce bool
}

// authenticateConnect verifies the Authorization header and returns an
// identity-bearing context. When enforce is false a failure yields the original
// context without identity rather than an error.
func (i *connectInterceptor) authenticateConnect(ctx context.Context, procedure string, header interface{ Values(string) []string }) (context.Context, error) {
	if isExempt(procedure) {
		return ctx, nil
	}
	claims, err := ParseAndVerify(bearerFrom(header.Values("Authorization")), i.secret)
	if err != nil {
		if !i.enforce {
			return ctx, nil
		}
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or missing service auth token"))
	}
	return WithIdentity(ctx, Identity{UserID: claims.Subject, WorkspaceID: claims.WorkspaceID, PlatformAdmin: claims.PlatformAdmin}), nil
}

func (i *connectInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		ctx, err := i.authenticateConnect(ctx, req.Spec().Procedure, req.Header())
		if err != nil {
			return nil, err
		}
		return next(ctx, req)
	}
}

func (i *connectInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx, err := i.authenticateConnect(ctx, conn.Spec().Procedure, conn.RequestHeader())
		if err != nil {
			return err
		}
		return next(ctx, conn)
	}
}

// WrapStreamingClient is a no-op: this interceptor only authenticates inbound
// server-side calls. Token minting on the client is handled in orbit-www.
func (i *connectInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}
