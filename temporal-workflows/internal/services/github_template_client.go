package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// GitHubTemplateClient handles GitHub API calls for template operations
type GitHubTemplateClient struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

// NewGitHubTemplateClient creates a new GitHub client
func NewGitHubTemplateClient(baseURL, token string) *GitHubTemplateClient {
	if baseURL == "" {
		baseURL = "https://api.github.com"
	}
	return &GitHubTemplateClient{
		baseURL:    baseURL,
		token:      token,
		httpClient: &http.Client{},
	}
}

type createFromTemplateRequest struct {
	Owner       string `json:"owner"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Private     bool   `json:"private"`
}

type createRepoRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Private     bool   `json:"private"`
	AutoInit    bool   `json:"auto_init"`
}

type repoResponse struct {
	HTMLURL string `json:"html_url"`
	Name    string `json:"name"`
}

// CreateRepoFromTemplate uses GitHub's template repository API
func (c *GitHubTemplateClient) CreateRepoFromTemplate(
	ctx context.Context,
	sourceOwner, sourceRepo, targetOrg, targetName, description string,
	private bool,
) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/generate", c.baseURL, sourceOwner, sourceRepo)

	body := createFromTemplateRequest{
		Owner:       targetOrg,
		Name:        targetName,
		Description: description,
		Private:     private,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result repoResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.HTMLURL, nil
}

// CreateRepository creates an empty repository
func (c *GitHubTemplateClient) CreateRepository(
	ctx context.Context,
	org, name, description string,
	private bool,
) (string, error) {
	url := fmt.Sprintf("%s/orgs/%s/repos", c.baseURL, org)

	body := createRepoRequest{
		Name:        name,
		Description: description,
		Private:     private,
		AutoInit:    false,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result repoResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.HTMLURL, nil
}
