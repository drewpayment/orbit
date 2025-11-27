package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGitHubTemplateClient_CreateRepoFromTemplate_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/repos/template-org/template-repo/generate", r.URL.Path)
		assert.Contains(t, r.Header.Get("Authorization"), "Bearer")
		assert.Equal(t, "application/vnd.github+json", r.Header.Get("Accept"))

		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"html_url": "https://github.com/my-org/new-repo", "name": "new-repo"}`))
	}))
	defer server.Close()

	client := NewGitHubTemplateClient(server.URL, "test-token")

	url, err := client.CreateRepoFromTemplate(
		context.Background(),
		"template-org", "template-repo",
		"my-org", "new-repo",
		"Description", true,
	)

	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-repo", url)
}

func TestGitHubTemplateClient_CreateRepoFromTemplate_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"message": "Repository creation failed"}`))
	}))
	defer server.Close()

	client := NewGitHubTemplateClient(server.URL, "test-token")

	_, err := client.CreateRepoFromTemplate(
		context.Background(),
		"template-org", "template-repo",
		"my-org", "new-repo",
		"Description", true,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "422")
}

func TestGitHubTemplateClient_CreateRepository_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/orgs/my-org/repos", r.URL.Path)

		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"html_url": "https://github.com/my-org/new-repo", "name": "new-repo"}`))
	}))
	defer server.Close()

	client := NewGitHubTemplateClient(server.URL, "test-token")

	url, err := client.CreateRepository(
		context.Background(),
		"my-org", "new-repo",
		"Description", true,
	)

	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-repo", url)
}

func TestGitHubTemplateClient_CreateRepository_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message": "Forbidden"}`))
	}))
	defer server.Close()

	client := NewGitHubTemplateClient(server.URL, "test-token")

	_, err := client.CreateRepository(
		context.Background(),
		"my-org", "new-repo",
		"Description", true,
	)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "403")
}

func TestGitHubTemplateClient_DefaultBaseURL(t *testing.T) {
	client := NewGitHubTemplateClient("", "test-token")
	assert.NotNil(t, client)
	// Can't easily test the baseURL is set correctly without exposing it
}
