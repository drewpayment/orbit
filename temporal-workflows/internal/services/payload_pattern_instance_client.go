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

// PatternFull mirrors the GET /api/internal/patterns/[id] response.
// Carries the executable content (templateJson, inputSchemaJson) the
// instance workflow needs to provision against — unlike PatternDoc
// returned by the list route, this is not LLM-bounded.
type PatternFull struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	DisplayName     string `json:"displayName"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	TemplateKind    string `json:"templateKind"`
	TemplateJSON    string `json:"templateJson"`
	InputSchemaJSON string `json:"inputSchemaJson"`
	Status          string `json:"status"`
	CurrentVersion  int    `json:"currentVersion"`
}

// PatternInstanceCreateInput is the body of POST /api/internal/pattern-instances.
type PatternInstanceCreateInput struct {
	WorkspaceID    string                 `json:"workspaceId"`
	PatternID      string                 `json:"patternId"`
	PatternVersion int                    `json:"patternVersion"`
	Name           string                 `json:"name"`
	AppID          string                 `json:"appId,omitempty"`
	Parameters     map[string]interface{} `json:"parameters"`
	CreatedByUser  string                 `json:"createdByUser,omitempty"`
	CreatedByRunID string                 `json:"createdByRunId,omitempty"`
	WorkflowID     string                 `json:"workflowId,omitempty"`
}

// PatternInstanceStatusInput is the body of PATCH
// /api/internal/pattern-instances/[id]/status.
type PatternInstanceStatusInput struct {
	Status       string                 `json:"status"`
	Outputs      map[string]interface{} `json:"outputs,omitempty"`
	ErrorMessage string                 `json:"errorMessage,omitempty"`
}

// ErrInstanceNameTaken is returned when (workspace, name) collides.
var ErrInstanceNameTaken = errors.New("pattern instance name already exists in workspace")

// ErrPatternNotFound is returned when a Pattern id doesn't resolve.
var ErrPatternNotFound = errors.New("pattern not found")

// PayloadPatternInstanceClient talks to the orbit-www internal API for
// the PatternInstances collection + the by-id Patterns route. Used by
// the temporal worker's instantiate_pattern dispatch.
type PayloadPatternInstanceClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

func NewPayloadPatternInstanceClient(baseURL, apiKey string, logger *slog.Logger) *PayloadPatternInstanceClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadPatternInstanceClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// GetPatternByID fetches the full content of a single Pattern.
func (c *PayloadPatternInstanceClient) GetPatternByID(ctx context.Context, id string) (PatternFull, error) {
	if id == "" {
		return PatternFull{}, errors.New("pattern id required")
	}
	u := c.baseURL + "/api/internal/patterns/" + url.PathEscape(id)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return PatternFull{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode == http.StatusNotFound {
		return PatternFull{}, ErrPatternNotFound
	}
	if resp.StatusCode/100 != 2 {
		return PatternFull{}, fmt.Errorf("get pattern: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var wrap struct {
		Pattern PatternFull `json:"pattern"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return PatternFull{}, err
	}
	return wrap.Pattern, nil
}

// CreateInstance creates a new PatternInstance row and returns its id.
func (c *PayloadPatternInstanceClient) CreateInstance(ctx context.Context, in PatternInstanceCreateInput) (string, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/internal/pattern-instances", bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusConflict {
		return "", ErrInstanceNameTaken
	}
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("create pattern instance: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

// UpdateStatus patches the row's status (and optional outputs /
// errorMessage). Called as the dispatch walks the lifecycle.
func (c *PayloadPatternInstanceClient) UpdateStatus(ctx context.Context, id string, in PatternInstanceStatusInput) error {
	if id == "" {
		return errors.New("instance id required")
	}
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPatch,
		c.baseURL+"/api/internal/pattern-instances/"+url.PathEscape(id)+"/status",
		bytes.NewReader(body))
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("update instance status: HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
