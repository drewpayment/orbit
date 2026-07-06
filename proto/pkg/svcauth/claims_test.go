package svcauth

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestEnforceWorkspace(t *testing.T) {
	withWid := func(wid string) context.Context {
		return WithIdentity(context.Background(), Identity{UserID: "u", WorkspaceID: wid})
	}

	t.Run("matching workspace is allowed", func(t *testing.T) {
		err := EnforceWorkspace(withWid("ws-1"), "ws-1")
		require.NoError(t, err)
	})

	t.Run("mismatched workspace is PermissionDenied", func(t *testing.T) {
		err := EnforceWorkspace(withWid("ws-1"), "ws-2")
		require.Error(t, err)
		assert.Equal(t, codes.PermissionDenied, status.Code(err))
	})

	t.Run("empty body workspace is allowed (no workspace scope)", func(t *testing.T) {
		err := EnforceWorkspace(withWid("ws-1"), "")
		require.NoError(t, err)
	})

	t.Run("missing identity is PermissionDenied", func(t *testing.T) {
		err := EnforceWorkspace(context.Background(), "ws-1")
		require.Error(t, err)
		assert.Equal(t, codes.PermissionDenied, status.Code(err))
	})

	t.Run("empty wid with workspace-scoped request is PermissionDenied", func(t *testing.T) {
		err := EnforceWorkspace(withWid(""), "ws-1")
		require.Error(t, err)
		assert.Equal(t, codes.PermissionDenied, status.Code(err))
	})
}

func TestEnforcePlatformAdmin(t *testing.T) {
	t.Run("admin identity is allowed", func(t *testing.T) {
		ctx := WithIdentity(context.Background(), Identity{UserID: "u", PlatformAdmin: true})
		require.NoError(t, EnforcePlatformAdmin(ctx))
	})

	t.Run("non-admin identity is PermissionDenied", func(t *testing.T) {
		ctx := WithIdentity(context.Background(), Identity{UserID: "u", PlatformAdmin: false})
		err := EnforcePlatformAdmin(ctx)
		require.Error(t, err)
		assert.Equal(t, codes.PermissionDenied, status.Code(err))
	})

	t.Run("missing identity is Unauthenticated", func(t *testing.T) {
		err := EnforcePlatformAdmin(context.Background())
		require.Error(t, err)
		assert.Equal(t, codes.Unauthenticated, status.Code(err))
	})
}

func TestIdentityRoundTrip(t *testing.T) {
	id := Identity{UserID: "user-123", WorkspaceID: "ws-456"}
	got, ok := IdentityFromContext(WithIdentity(context.Background(), id))
	require.True(t, ok)
	assert.Equal(t, id, got)

	_, ok = IdentityFromContext(context.Background())
	assert.False(t, ok)
}

func TestIsExempt(t *testing.T) {
	exempt := []string{
		"/grpc.health.v1.Health/Check",
		"/grpc.health.v1.Health/Watch",
		"/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
		"/idp.health.v1.HealthService/Check",
	}
	for _, m := range exempt {
		assert.Truef(t, isExempt(m), "expected %s to be exempt", m)
	}

	notExempt := []string{
		"/idp.kafka.v1.KafkaService/CreateServiceAccount",
		"/idp.repository.v1.RepositoryService/CreateRepository",
		"/idp.template.v1.TemplateService/StartInstantiation",
	}
	for _, m := range notExempt {
		assert.Falsef(t, isExempt(m), "expected %s to require auth", m)
	}
}

func TestBearerFrom(t *testing.T) {
	assert.Equal(t, "abc", bearerFrom([]string{"Bearer abc"}))
	assert.Equal(t, "abc", bearerFrom([]string{"bearer abc"}))
	assert.Equal(t, "", bearerFrom([]string{"abc"}))
	assert.Equal(t, "", bearerFrom(nil))
	assert.Equal(t, "", bearerFrom([]string{""}))
	assert.Equal(t, "abc", bearerFrom([]string{"Basic xyz", "Bearer abc"}))
}
