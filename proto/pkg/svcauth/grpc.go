package svcauth

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// UnaryServerInterceptor verifies the bearer token on every unary call (for
// services on google.golang.org/grpc, i.e. kafka) and injects the verified
// Identity into the handler context. Exempt methods pass through untouched.
//
// When enforce is false the interceptor still injects identity if a valid token
// is present but does NOT reject missing/invalid tokens — this is the temporary
// ORBIT_SVC_AUTH_ENFORCE=false rollout bisect knob and must be removed after the
// phase-0 deploy is confirmed healthy. Default wiring passes enforce=true.
func UnaryServerInterceptor(secret []byte, enforce bool) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if isExempt(info.FullMethod) {
			return handler(ctx, req)
		}
		ctx, err := authenticate(ctx, secret, enforce)
		if err != nil {
			return nil, err
		}
		return handler(ctx, req)
	}
}

// StreamServerInterceptor mirrors UnaryServerInterceptor for streaming RPCs,
// verifying at stream open and wrapping the stream so the handler sees the
// identity-bearing context.
func StreamServerInterceptor(secret []byte, enforce bool) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if isExempt(info.FullMethod) {
			return handler(srv, ss)
		}
		ctx, err := authenticate(ss.Context(), secret, enforce)
		if err != nil {
			return err
		}
		return handler(srv, &identityStream{ServerStream: ss, ctx: ctx})
	}
}

// authenticate extracts and verifies the bearer token from incoming gRPC
// metadata. On success it returns a context carrying the Identity. When enforce
// is false a verification failure is swallowed (the original context is
// returned without identity) rather than rejecting the call.
func authenticate(ctx context.Context, secret []byte, enforce bool) (context.Context, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	claims, err := ParseAndVerify(bearerFrom(md.Get("authorization")), secret)
	if err != nil {
		if !enforce {
			return ctx, nil
		}
		return nil, status.Error(codes.Unauthenticated, "invalid or missing service auth token")
	}
	return WithIdentity(ctx, Identity{UserID: claims.Subject, WorkspaceID: claims.WorkspaceID, PlatformAdmin: claims.PlatformAdmin}), nil
}

// identityStream overrides Context() so the wrapped handler observes the
// identity-bearing context instead of the original.
type identityStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *identityStream) Context() context.Context { return s.ctx }
