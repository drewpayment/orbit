package svcauth

import (
	"context"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeAnyRequest is a minimal connect.AnyRequest for exercising WrapUnary
// without spinning up an HTTP server. Only Spec() and Header() are consulted by
// the interceptor.
type fakeAnyRequest struct {
	connect.AnyRequest
	procedure string
	header    http.Header
}

func (f *fakeAnyRequest) Spec() connect.Spec { return connect.Spec{Procedure: f.procedure} }
func (f *fakeAnyRequest) Header() http.Header { return f.header }

func newFakeReq(procedure string, header http.Header) *fakeAnyRequest {
	if header == nil {
		header = http.Header{}
	}
	return &fakeAnyRequest{procedure: procedure, header: header}
}

func TestConnectInterceptorWrapUnary(t *testing.T) {
	interceptor := NewConnectInterceptor(testSecret, true)

	t.Run("valid token injects identity and calls next", func(t *testing.T) {
		tok := mintForTest(t, testSecret, jwt.SigningMethodHS256, nil)
		h := http.Header{}
		h.Set("Authorization", "Bearer "+tok)
		called := false
		next := connect.UnaryFunc(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
			called = true
			id, ok := IdentityFromContext(ctx)
			require.True(t, ok)
			assert.Equal(t, "user-123", id.UserID)
			assert.Equal(t, "ws-456", id.WorkspaceID)
			return nil, nil
		})
		_, err := interceptor.WrapUnary(next)(context.Background(), newFakeReq("/idp.repository.v1.RepositoryService/CreateRepository", h))
		require.NoError(t, err)
		assert.True(t, called)
	})

	t.Run("missing token rejects with CodeUnauthenticated and next never runs", func(t *testing.T) {
		next := connect.UnaryFunc(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
			t.Fatal("next must not run")
			return nil, nil
		})
		_, err := interceptor.WrapUnary(next)(context.Background(), newFakeReq("/idp.repository.v1.RepositoryService/CreateRepository", nil))
		require.Error(t, err)
		assert.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	})

	t.Run("forged user-id header without a token is rejected", func(t *testing.T) {
		// Regression for GO-H1 on the Connect path.
		h := http.Header{}
		h.Set("user-id", "11111111-1111-1111-1111-111111111111")
		next := connect.UnaryFunc(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
			t.Fatal("next must not run")
			return nil, nil
		})
		_, err := interceptor.WrapUnary(next)(context.Background(), newFakeReq("/idp.repository.v1.RepositoryService/CreateRepository", h))
		require.Error(t, err)
		assert.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	})

	t.Run("exempt procedure passes through without a token", func(t *testing.T) {
		called := false
		next := connect.UnaryFunc(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
			called = true
			return nil, nil
		})
		_, err := interceptor.WrapUnary(next)(context.Background(), newFakeReq("/idp.health.v1.HealthService/Check", nil))
		require.NoError(t, err)
		assert.True(t, called)
	})
}
