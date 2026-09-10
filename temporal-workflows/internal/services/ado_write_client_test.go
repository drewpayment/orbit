package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildADOAuthHeader(t *testing.T) {
	assert.Equal(t, "Basic OnNlY3JldC1wYXQ=", BuildADOAuthHeader("basic-pat", "secret-pat"))
	assert.Equal(t, "Basic OnNlY3JldC1wYXQ=", BuildADOAuthHeader("", "secret-pat"))
	assert.Equal(t, "Bearer some-token", BuildADOAuthHeader("bearer", "some-token"))
}

func TestADOWriteClient_CreateRepository_Success(t *testing.T) {
	var gotAuth, gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"repo-1","remoteUrl":"https://dev.azure.com/acme/proj/_git/orders","webUrl":"https://dev.azure.com/acme/proj/_git/orders"}`))
	}))
	defer srv.Close()

	c := NewADOWriteClient(srv.URL, "Basic secret", nil)
	result, err := c.CreateRepository(context.Background(), "acme", "proj", "orders")
	require.NoError(t, err)
	assert.Equal(t, "repo-1", result.RepoID)
	assert.Equal(t, "https://dev.azure.com/acme/proj/_git/orders", result.RepoURL)
	assert.Equal(t, "https://dev.azure.com/acme/proj/_git/orders", result.CloneURL)
	assert.Equal(t, "proj", result.Project)
	assert.Equal(t, "Basic secret", gotAuth)
	assert.Contains(t, gotPath, "/acme/proj/_apis/git/repositories")
	assert.Equal(t, "orders", gotBody["name"])
}

func TestADOWriteClient_CreateRepository_MissingFields(t *testing.T) {
	c := NewADOWriteClient("https://example.invalid", "Basic secret", nil)
	_, err := c.CreateRepository(context.Background(), "", "proj", "orders")
	require.ErrorIs(t, err, ErrADOInvalidInput)
}

func TestADOWriteClient_CreatePullRequest_Success(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"pullRequestId":42}`))
	}))
	defer srv.Close()

	c := NewADOWriteClient(srv.URL, "Basic secret", nil)
	result, err := c.CreatePullRequest(context.Background(), "acme", "proj", "repo-1", "feature/x", "main", "Add x", "desc")
	require.NoError(t, err)
	assert.Equal(t, "42", result.PRID)
	assert.Contains(t, result.PRURL, "pullrequest/42")
	assert.Equal(t, "refs/heads/feature/x", gotBody["sourceRefName"])
	assert.Equal(t, "refs/heads/main", gotBody["targetRefName"])
}

func TestADOWriteClient_CreatePipeline_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":7,"url":"https://dev.azure.com/acme/proj/_apis/pipelines/7","_links":{"web":{"href":"https://dev.azure.com/acme/proj/_build?definitionId=7"}}}`))
	}))
	defer srv.Close()

	c := NewADOWriteClient(srv.URL, "Basic secret", nil)
	result, err := c.CreatePipeline(context.Background(), "acme", "proj", "orders-ci", "repo-1", "")
	require.NoError(t, err)
	assert.Equal(t, "7", result.PipelineID)
	assert.Equal(t, "https://dev.azure.com/acme/proj/_build?definitionId=7", result.PipelineURL)
}

func TestADOWriteClient_CreatePipeline_MissingFields(t *testing.T) {
	c := NewADOWriteClient("https://example.invalid", "Basic secret", nil)
	_, err := c.CreatePipeline(context.Background(), "acme", "proj", "", "repo-1", "")
	require.ErrorIs(t, err, ErrADOInvalidInput)
}

// TestADOWriteClient_Unauthorized_NeverLeaksPAT is the security assertion
// CLAUDE.md's ADO write-path scope requires: a 401 must produce a clear,
// caller-actionable error whose text never contains the PAT used to
// authenticate the (failing) request.
func TestADOWriteClient_Unauthorized_NeverLeaksPAT(t *testing.T) {
	const pat = "super-secret-pat-value-should-never-leak"
	authHeader := BuildADOAuthHeader("basic-pat", pat)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Echo the Authorization header back in the body — a hostile or
		// misconfigured server is exactly the case the client must defend
		// against by never surfacing the response body in its error.
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"auth failed, header was: ` + r.Header.Get("Authorization") + `"}`))
	}))
	defer srv.Close()

	c := NewADOWriteClient(srv.URL, authHeader, nil)
	_, err := c.CreateRepository(context.Background(), "acme", "proj", "orders")
	require.Error(t, err)
	require.ErrorIs(t, err, ErrADOInvalidInput)
	assert.NotContains(t, err.Error(), pat)
	assert.NotContains(t, err.Error(), authHeader)
	assert.False(t, strings.Contains(err.Error(), "auth failed"), "error must not echo the response body")
}

func TestADOWriteClient_ServerError_IsRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	c := NewADOWriteClient(srv.URL, "Basic secret", nil)
	_, err := c.CreateRepository(context.Background(), "acme", "proj", "orders")
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrADOInvalidInput, "5xx must not be classified as invalid input")
}
