package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

// FinalizeInstantiationInput is the body of
// POST /api/internal/templates/{id}/finalize.
type FinalizeInstantiationInput struct {
	WorkspaceID string `json:"workspaceId"`
	RepoURL     string `json:"repoUrl"`
	RepoName    string `json:"repoName"`
	UserID      string `json:"userId,omitempty"`
}

// FinalizeInstantiationResult is the response of
// POST /api/internal/templates/{id}/finalize.
type FinalizeInstantiationResult struct {
	CatalogEntityID string `json:"catalogEntityId"`
	UsageCount      int    `json:"usageCount"`
}

// ErrTemplateNotFound is returned when a Template id doesn't resolve.
var ErrTemplateNotFound = errors.New("template not found")

// PayloadTemplateClient talks to the orbit-www internal API to finalize a
// template instantiation (increment usage count, create a catalog entity).
// Mirrors PayloadPatternInstanceClient's shape and conventions.
type PayloadTemplateClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPayloadTemplateClient(baseURL, apiKey string, logger *slog.Logger) *PayloadTemplateClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadTemplateClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// FinalizeInstantiation calls POST {baseURL}/api/internal/templates/{templateID}/finalize.
func (c *PayloadTemplateClient) FinalizeInstantiation(ctx context.Context, templateID string, in FinalizeInstantiationInput) (*FinalizeInstantiationResult, error) {
	if templateID == "" {
		return nil, errors.New("template id required")
	}

	body, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}

	u := c.baseURL + "/api/internal/templates/" + url.PathEscape(templateID) + "/finalize"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrTemplateNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("finalize instantiation: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out FinalizeInstantiationResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
