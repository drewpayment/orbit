// services/bifrost/internal/proxy/bifrost_authenticator_test.go
package proxy

import (
	"errors"
	"testing"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockSASLHandler for testing
type mockSASLHandler struct {
	ctx *auth.ConnectionContext
	err error
}

func (m *mockSASLHandler) Authenticate(username, password string) (*auth.ConnectionContext, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.ctx, nil
}

func TestBifrostAuthenticator_Authenticate_Success(t *testing.T) {
	expectedCtx := &auth.ConnectionContext{
		CredentialID:     "cred-123",
		VirtualClusterID: "vc-456",
		Username:         "testuser",
		TopicPrefix:      "tenant-a:",
		GroupPrefix:      "tenant-a:",
		TxnIDPrefix:      "tenant-a:",
		BootstrapServers: "kafka:9092",
	}

	handler := &mockSASLHandler{ctx: expectedCtx}
	authenticator := NewBifrostAuthenticator(handler)

	ok, status, err := authenticator.Authenticate("testuser", "testpass")

	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int32(0), status)

	// Should be able to retrieve context after auth
	ctx := authenticator.GetContext()
	require.NotNil(t, ctx)
	assert.Equal(t, "vc-456", ctx.VirtualClusterID)
	assert.Equal(t, "tenant-a:", ctx.TopicPrefix)
}

func TestBifrostAuthenticator_Authenticate_Failure(t *testing.T) {
	handler := &mockSASLHandler{err: auth.ErrAuthFailed}
	authenticator := NewBifrostAuthenticator(handler)

	ok, status, err := authenticator.Authenticate("baduser", "badpass")

	require.NoError(t, err) // Error is signaled via ok=false, not error return
	assert.False(t, ok)
	assert.Equal(t, int32(1), status)

	// Context should be nil after failed auth
	ctx := authenticator.GetContext()
	assert.Nil(t, ctx)
}

func TestBifrostAuthenticator_Authenticate_UnknownUser(t *testing.T) {
	handler := &mockSASLHandler{err: auth.ErrUnknownUser}
	authenticator := NewBifrostAuthenticator(handler)

	ok, status, err := authenticator.Authenticate("unknown", "pass")

	require.NoError(t, err)
	assert.False(t, ok)
	assert.Equal(t, int32(2), status) // Different status for unknown user
}

func TestBifrostAuthenticator_Authenticate_InvalidCluster(t *testing.T) {
	handler := &mockSASLHandler{err: auth.ErrInvalidCluster}
	authenticator := NewBifrostAuthenticator(handler)

	ok, status, err := authenticator.Authenticate("user", "pass")

	require.NoError(t, err)
	assert.False(t, ok)
	assert.Equal(t, int32(3), status) // Different status for invalid cluster
}

func TestBifrostAuthenticator_Authenticate_UnexpectedError(t *testing.T) {
	unexpectedErr := errors.New("database connection failed")
	handler := &mockSASLHandler{err: unexpectedErr}
	authenticator := NewBifrostAuthenticator(handler)

	ok, status, err := authenticator.Authenticate("user", "pass")

	require.Error(t, err)
	assert.Equal(t, unexpectedErr, err)
	assert.False(t, ok)
	assert.Equal(t, int32(0), status)
}

func TestBifrostAuthenticator_GetContext_BeforeAuth(t *testing.T) {
	handler := &mockSASLHandler{}
	authenticator := NewBifrostAuthenticator(handler)

	// Context should be nil before any auth attempt
	ctx := authenticator.GetContext()
	assert.Nil(t, ctx)
}

func TestBifrostAuthenticator_GetContext_AfterFailedAuth(t *testing.T) {
	handler := &mockSASLHandler{err: auth.ErrAuthFailed}
	authenticator := NewBifrostAuthenticator(handler)

	// Attempt failed auth
	ok, _, _ := authenticator.Authenticate("user", "wrong")
	assert.False(t, ok)

	// Context should still be nil
	ctx := authenticator.GetContext()
	assert.Nil(t, ctx)
}

func TestBifrostAuthenticator_ContextOverwrittenOnSubsequentAuth(t *testing.T) {
	ctx1 := &auth.ConnectionContext{
		CredentialID:     "cred-1",
		VirtualClusterID: "vc-1",
		Username:         "user1",
		TopicPrefix:      "tenant-1:",
	}
	ctx2 := &auth.ConnectionContext{
		CredentialID:     "cred-2",
		VirtualClusterID: "vc-2",
		Username:         "user2",
		TopicPrefix:      "tenant-2:",
	}

	handler := &mockSASLHandler{ctx: ctx1}
	authenticator := NewBifrostAuthenticator(handler)

	// First auth
	ok, _, err := authenticator.Authenticate("user1", "pass1")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "vc-1", authenticator.GetContext().VirtualClusterID)

	// Second auth with different context
	handler.ctx = ctx2
	ok, _, err = authenticator.Authenticate("user2", "pass2")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "vc-2", authenticator.GetContext().VirtualClusterID)
}
