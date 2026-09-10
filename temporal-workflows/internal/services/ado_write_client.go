package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// adoWriteAPIVersion pins every ADO write REST call to the same API version
// the read-only scan activities use (see ado_scan_activities.go's
// adoAPIVersion) — kept as a separate constant because this package cannot
// import the activities package.
const adoWriteAPIVersion = "7.1"

// ErrADOInvalidInput marks an ADO write failure caused by the caller's
// input — a bad org/project/repo reference, a missing pipeline YAML file,
// or rejected credentials — rather than a transient Azure DevOps problem.
// Callers (the ado:* scaffolder actions) map this to scaffolder.ErrInvalidInput
// so the workflow does not retry a request that will never succeed.
var ErrADOInvalidInput = errors.New("azure devops rejected the request")

// ADOWriteClient is the write-path counterpart to the read-only ADO scan
// activities' inline REST calls: repository, pull request, and pipeline
// creation. Auth is either HTTP Basic (PAT, empty username) or Bearer (a
// short-lived Microsoft Entra token for service-principal connections),
// matching the resolved connection's auth mode.
//
// SECURITY: the credential passed to NewADOWriteClient must never appear in
// a log line or an error string. It lives only in the Authorization header;
// every error path here returns status codes only, never response bodies or
// request headers.
type ADOWriteClient struct {
	baseURL    string // e.g. https://dev.azure.com
	authHeader string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewADOWriteClient constructs a client authenticated with authHeader (a
// full Authorization header value — see BuildADOAuthHeader). baseURL
// defaults to https://dev.azure.com when empty (matching the connection's
// own BaseURL convention, which is normally already populated).
func NewADOWriteClient(baseURL, authHeader string, logger *slog.Logger) *ADOWriteClient {
	if baseURL == "" {
		baseURL = "https://dev.azure.com"
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &ADOWriteClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		authHeader: authHeader,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
	}
}

// BuildADOAuthHeader builds the Authorization header value for a resolved
// connection token, mirroring ado_scan_activities.go's
// adoConnectionInfo.authorizationHeader: "bearer" -> a Bearer token,
// anything else (the default "basic-pat") -> HTTP Basic with an empty
// username and the PAT as password.
func BuildADOAuthHeader(authMode, token string) string {
	if authMode == "bearer" {
		return "Bearer " + token
	}
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(":"+token))
}

// ADORepoResult is the outcome of CreateRepository.
type ADORepoResult struct {
	RepoID   string
	RepoURL  string
	CloneURL string
	Project  string
}

// CreateRepository creates an empty repository inside an existing ADO
// project. https://dev.azure.com/{org}/{project}/_apis/git/repositories
func (c *ADOWriteClient) CreateRepository(ctx context.Context, org, project, name string) (*ADORepoResult, error) {
	if org == "" || project == "" || name == "" {
		return nil, fmt.Errorf("%w: org, project, and name are required", ErrADOInvalidInput)
	}
	u := fmt.Sprintf("%s/%s/%s/_apis/git/repositories?api-version=%s",
		c.baseURL, url.PathEscape(org), url.PathEscape(project), adoWriteAPIVersion)

	body, err := c.do(ctx, http.MethodPost, u, map[string]any{"name": name})
	if err != nil {
		return nil, err
	}

	var parsed struct {
		ID        string `json:"id"`
		RemoteURL string `json:"remoteUrl"`
		WebURL    string `json:"webUrl"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("ado write client: parse create-repository response: %w", err)
	}
	return &ADORepoResult{
		RepoID:   parsed.ID,
		RepoURL:  parsed.WebURL,
		CloneURL: parsed.RemoteURL,
		Project:  project,
	}, nil
}

// ADOPullRequestResult is the outcome of CreatePullRequest.
type ADOPullRequestResult struct {
	PRID  string
	PRURL string
}

// CreatePullRequest opens a pull request against an existing repository.
// https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoId}/pullrequests
func (c *ADOWriteClient) CreatePullRequest(ctx context.Context, org, project, repoID, sourceBranch, targetBranch, title, description string) (*ADOPullRequestResult, error) {
	if org == "" || project == "" || repoID == "" || sourceBranch == "" || targetBranch == "" || title == "" {
		return nil, fmt.Errorf("%w: org, project, repoId, sourceBranch, targetBranch, and title are required", ErrADOInvalidInput)
	}
	u := fmt.Sprintf("%s/%s/%s/_apis/git/repositories/%s/pullrequests?api-version=%s",
		c.baseURL, url.PathEscape(org), url.PathEscape(project), url.PathEscape(repoID), adoWriteAPIVersion)

	payload := map[string]any{
		"sourceRefName": refName(sourceBranch),
		"targetRefName": refName(targetBranch),
		"title":         title,
		"description":   description,
	}
	body, err := c.do(ctx, http.MethodPost, u, payload)
	if err != nil {
		return nil, err
	}

	var parsed struct {
		PullRequestID int `json:"pullRequestId"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("ado write client: parse create-pull-request response: %w", err)
	}
	prID := fmt.Sprintf("%d", parsed.PullRequestID)
	prURL := fmt.Sprintf("%s/%s/%s/_git/%s/pullrequest/%s",
		c.baseURL, url.PathEscape(org), url.PathEscape(project), url.PathEscape(repoID), prID)
	return &ADOPullRequestResult{PRID: prID, PRURL: prURL}, nil
}

// ADOPipelineResult is the outcome of CreatePipeline.
type ADOPipelineResult struct {
	PipelineID  string
	PipelineURL string
}

// CreatePipeline creates a YAML-backed pipeline pointing at yamlPath in an
// existing repository. This is a bounded first cut: it assumes the YAML file
// already exists (from an earlier fs:render/git:push step) and generates no
// pipeline content itself — a missing file surfaces as ADO's own API error.
// https://dev.azure.com/{org}/{project}/_apis/pipelines
func (c *ADOWriteClient) CreatePipeline(ctx context.Context, org, project, name, repoID, yamlPath string) (*ADOPipelineResult, error) {
	if org == "" || project == "" || name == "" || repoID == "" {
		return nil, fmt.Errorf("%w: org, project, name, and repoId are required", ErrADOInvalidInput)
	}
	if yamlPath == "" {
		yamlPath = "azure-pipelines.yml"
	}
	u := fmt.Sprintf("%s/%s/%s/_apis/pipelines?api-version=%s",
		c.baseURL, url.PathEscape(org), url.PathEscape(project), adoWriteAPIVersion)

	payload := map[string]any{
		"name": name,
		"configuration": map[string]any{
			"type": "yaml",
			"path": yamlPath,
			"repository": map[string]any{
				"id":   repoID,
				"type": "azureReposGit",
			},
		},
	}
	body, err := c.do(ctx, http.MethodPost, u, payload)
	if err != nil {
		return nil, err
	}

	var parsed struct {
		ID    int    `json:"id"`
		URL   string `json:"url"`
		Links struct {
			Web struct {
				Href string `json:"href"`
			} `json:"web"`
		} `json:"_links"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("ado write client: parse create-pipeline response: %w", err)
	}
	pipelineURL := parsed.Links.Web.Href
	if pipelineURL == "" {
		pipelineURL = parsed.URL
	}
	return &ADOPipelineResult{PipelineID: fmt.Sprintf("%d", parsed.ID), PipelineURL: pipelineURL}, nil
}

// refName normalizes a branch name into a full refs/heads/ ref, tolerating
// callers that already pass one.
func refName(branch string) string {
	return "refs/heads/" + strings.TrimPrefix(branch, "refs/heads/")
}

// do performs an authenticated ADO REST call. It maps status codes to error
// classes the caller can distinguish: 2xx succeeds; 4xx is caller-input-shaped
// (bad org/project/repo, rejected credentials, malformed body) and wrapped in
// ErrADOInvalidInput; everything else (5xx, and Do's own network error) is a
// plain, retryable error.
//
// SECURITY: only the HTTP status code is ever included in a returned error —
// never the response body (which could echo request detail) and never any
// request header (which carries the Authorization/PAT value).
func (c *ADOWriteClient) do(ctx context.Context, method, u string, payload any) ([]byte, error) {
	var reqBody io.Reader
	if payload != nil {
		buf, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("ado write client: marshal request: %w", err)
		}
		reqBody = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return nil, fmt.Errorf("ado write client: build request: %w", err)
	}
	req.Header.Set("Authorization", c.authHeader)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ado write client: request failed: %w", err) // network — retryable
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	switch {
	case resp.StatusCode/100 == 2:
		return body, nil
	case resp.StatusCode/100 == 4:
		return nil, fmt.Errorf("%w: azure devops HTTP %d", ErrADOInvalidInput, resp.StatusCode)
	default:
		return nil, fmt.Errorf("ado write client: azure devops HTTP %d", resp.StatusCode)
	}
}
