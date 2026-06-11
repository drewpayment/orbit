package grpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/template/v1/templatev1connect"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const repoTestAuthSecret = "repository-test-secret-at-least-32-bytes!!"

func mintRepoToken(t *testing.T, sub, wid string) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": "orbit-www",
		"aud": "orbit-services",
		"sub": sub,
		"wid": wid,
		"iat": now.Unix(),
		"exp": now.Add(120 * time.Second).Unix(),
		"jti": uuid.NewString(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(repoTestAuthSecret))
	require.NoError(t, err)
	return signed
}

// newAuthedTemplateServer starts the real TemplateService Connect handler behind
// the svcauth interceptor on an httptest server, exactly as cmd/server/main.go
// wires it. The handler's deps are nil because the protected RPCs are rejected
// by the interceptor before they ever run.
func newAuthedTemplateServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := NewTemplateServer(nil, nil)
	interceptor := connect.WithInterceptors(svcauth.NewConnectInterceptor([]byte(repoTestAuthSecret), true))
	path, handler := templatev1connect.NewTemplateServiceHandler(srv, interceptor)
	mux := http.NewServeMux()
	mux.Handle(path, handler)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts
}

func TestRepositoryConnectAuth_TokenlessRejected(t *testing.T) {
	// GO-H1: a call with no bearer token must be rejected before the handler.
	ts := newAuthedTemplateServer(t)
	client := templatev1connect.NewTemplateServiceClient(http.DefaultClient, ts.URL)

	_, err := client.StartInstantiation(context.Background(),
		connect.NewRequest(&templatev1.StartInstantiationRequest{
			TemplateId:  uuid.NewString(),
			WorkspaceId: uuid.NewString(),
		}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
}

func TestRepositoryConnectAuth_ForgedUserIDHeaderRejected(t *testing.T) {
	// GO-H1 regression: the legacy forgeable path trusted a "user-id" header.
	// Setting it without a valid bearer token must NOT authenticate the call.
	ts := newAuthedTemplateServer(t)
	client := templatev1connect.NewTemplateServiceClient(http.DefaultClient, ts.URL)

	req := connect.NewRequest(&templatev1.StartInstantiationRequest{
		TemplateId:  uuid.NewString(),
		WorkspaceId: uuid.NewString(),
	})
	req.Header().Set("user-id", "11111111-1111-1111-1111-111111111111")

	_, err := client.StartInstantiation(context.Background(), req)

	require.Error(t, err)
	assert.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
}

func TestRepositoryConnectAuth_ValidTokenReachesHandler(t *testing.T) {
	// A valid token passes the interceptor and the handler runs. With a nil
	// temporal client StartInstantiation returns a non-auth error, which proves
	// the request got past authentication (the interceptor did not short-circuit
	// it with Unauthenticated).
	ts := newAuthedTemplateServer(t)
	client := templatev1connect.NewTemplateServiceClient(http.DefaultClient, ts.URL)

	wid := uuid.NewString()
	req := connect.NewRequest(&templatev1.StartInstantiationRequest{
		TemplateId:  uuid.NewString(),
		WorkspaceId: wid,
	})
	req.Header().Set("Authorization", "Bearer "+mintRepoToken(t, uuid.NewString(), wid))

	_, err := client.StartInstantiation(context.Background(), req)

	if err != nil {
		assert.NotEqual(t, connect.CodeUnauthenticated, connect.CodeOf(err),
			"a valid token must not be rejected as unauthenticated")
	}
}
