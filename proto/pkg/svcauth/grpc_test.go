package svcauth

import (
	"context"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func authMD(t *testing.T) context.Context {
	tok := mintForTest(t, testSecret, jwt.SigningMethodHS256, nil)
	md := metadata.Pairs("authorization", "Bearer "+tok)
	return metadata.NewIncomingContext(context.Background(), md)
}

func TestUnaryServerInterceptor(t *testing.T) {
	interceptor := UnaryServerInterceptor(testSecret, true)

	t.Run("valid token injects identity and calls handler", func(t *testing.T) {
		called := false
		handler := func(ctx context.Context, _ any) (any, error) {
			called = true
			id, ok := IdentityFromContext(ctx)
			require.True(t, ok)
			assert.Equal(t, "user-123", id.UserID)
			assert.Equal(t, "ws-456", id.WorkspaceID)
			return "ok", nil
		}
		info := &grpc.UnaryServerInfo{FullMethod: "/idp.kafka.v1.KafkaService/CreateServiceAccount"}
		resp, err := interceptor(authMD(t), nil, info, handler)
		require.NoError(t, err)
		assert.Equal(t, "ok", resp)
		assert.True(t, called)
	})

	t.Run("missing token rejects and handler never runs", func(t *testing.T) {
		called := false
		handler := func(ctx context.Context, _ any) (any, error) {
			called = true
			return nil, nil
		}
		info := &grpc.UnaryServerInfo{FullMethod: "/idp.kafka.v1.KafkaService/CreateServiceAccount"}
		_, err := interceptor(context.Background(), nil, info, handler)
		require.Error(t, err)
		assert.Equal(t, codes.Unauthenticated, status.Code(err))
		assert.False(t, called, "handler must not run for an unauthenticated request")
	})

	t.Run("forged user-id metadata without a token is rejected", func(t *testing.T) {
		// Regression for GO-H1: the old code trusted a "user-id" metadata header.
		// Setting it without a valid bearer token must NOT authenticate the call.
		md := metadata.Pairs("user-id", "11111111-1111-1111-1111-111111111111")
		ctx := metadata.NewIncomingContext(context.Background(), md)
		handler := func(ctx context.Context, _ any) (any, error) {
			t.Fatal("handler must not run")
			return nil, nil
		}
		info := &grpc.UnaryServerInfo{FullMethod: "/idp.kafka.v1.KafkaService/CreateServiceAccount"}
		_, err := interceptor(ctx, nil, info, handler)
		require.Error(t, err)
		assert.Equal(t, codes.Unauthenticated, status.Code(err))
	})

	t.Run("exempt method passes through without a token", func(t *testing.T) {
		called := false
		handler := func(ctx context.Context, _ any) (any, error) {
			called = true
			return "pong", nil
		}
		info := &grpc.UnaryServerInfo{FullMethod: "/grpc.health.v1.Health/Check"}
		_, err := interceptor(context.Background(), nil, info, handler)
		require.NoError(t, err)
		assert.True(t, called)
	})

	t.Run("enforce=false injects identity but tolerates a missing token", func(t *testing.T) {
		lenient := UnaryServerInterceptor(testSecret, false)
		handler := func(ctx context.Context, _ any) (any, error) {
			_, ok := IdentityFromContext(ctx)
			assert.False(t, ok, "no identity expected when token absent")
			return "ok", nil
		}
		info := &grpc.UnaryServerInfo{FullMethod: "/idp.kafka.v1.KafkaService/ListServiceAccounts"}
		_, err := lenient(context.Background(), nil, info, handler)
		require.NoError(t, err)
	})
}
