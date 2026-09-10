package services

import (
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

// ErrTemplateDefinitionNotFound is returned when a template-definitions id
// doesn't resolve.
var ErrTemplateDefinitionNotFound = errors.New("template definition not found")

// ErrTemplateDefinitionVersionNotFound is returned when a
// template-definition-versions id doesn't resolve. Distinct from
// PayloadTemplateClient's ErrTemplateNotFound, which addresses the (older,
// v1) Templates collection.
var ErrTemplateDefinitionVersionNotFound = errors.New("template definition version not found")

// TemplateDefinitionSummary is the wire shape of
// GET /api/internal/template-definitions/[id].
type TemplateDefinitionSummary struct {
	ID               string
	WorkspaceID      string
	Status           string
	CurrentVersionID string
	Name             string
}

// TemplateDefinitionVersion is the wire shape of
// GET /api/internal/template-definition-versions/[id].
type TemplateDefinitionVersion struct {
	ID             string
	DefinitionID   string
	WorkspaceID    string
	DefinitionJSON json.RawMessage
}

// PayloadTemplateDefinitionsClient reads template-definitions and
// template-definition-versions rows from the orbit-www internal API. Used
// by the `fetch:template` composition step (Phase 4 Task D) to resolve
// `templateDefinitionId` (+ optional pinned `version`) to the definition
// document a nested ScaffolderWorkflow should run.
type PayloadTemplateDefinitionsClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadTemplateDefinitionsClient constructs the client.
func NewPayloadTemplateDefinitionsClient(baseURL, apiKey string, logger *slog.Logger) *PayloadTemplateDefinitionsClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadTemplateDefinitionsClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

type templateDefinitionResponse struct {
	Definition struct {
		ID             string `json:"id"`
		Workspace      string `json:"workspace"`
		Status         string `json:"status"`
		CurrentVersion string `json:"currentVersion"`
		Name           string `json:"name"`
	} `json:"definition"`
}

// GetDefinition calls GET {baseURL}/api/internal/template-definitions/{id}.
func (c *PayloadTemplateDefinitionsClient) GetDefinition(ctx context.Context, id string) (TemplateDefinitionSummary, error) {
	if id == "" {
		return TemplateDefinitionSummary{}, errors.New("template definitions client: id required")
	}
	u := c.baseURL + "/api/internal/template-definitions/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return TemplateDefinitionSummary{}, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return TemplateDefinitionSummary{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		return TemplateDefinitionSummary{}, ErrTemplateDefinitionNotFound
	}
	if resp.StatusCode/100 != 2 {
		return TemplateDefinitionSummary{}, fmt.Errorf("template definitions get: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var decoded templateDefinitionResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return TemplateDefinitionSummary{}, err
	}
	return TemplateDefinitionSummary{
		ID:               decoded.Definition.ID,
		WorkspaceID:      decoded.Definition.Workspace,
		Status:           decoded.Definition.Status,
		CurrentVersionID: decoded.Definition.CurrentVersion,
		Name:             decoded.Definition.Name,
	}, nil
}

type templateDefinitionVersionResponse struct {
	Version struct {
		ID             string          `json:"id"`
		Definition     string          `json:"definition"`
		Workspace      string          `json:"workspace"`
		VersionNumber  int             `json:"versionNumber"`
		DefinitionJSON json.RawMessage `json:"definitionJson"`
	} `json:"version"`
}

// GetDefinitionVersion calls
// GET {baseURL}/api/internal/template-definition-versions/{id}.
func (c *PayloadTemplateDefinitionsClient) GetDefinitionVersion(ctx context.Context, id string) (TemplateDefinitionVersion, error) {
	if id == "" {
		return TemplateDefinitionVersion{}, errors.New("template definitions client: version id required")
	}
	u := c.baseURL + "/api/internal/template-definition-versions/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return TemplateDefinitionVersion{}, err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return TemplateDefinitionVersion{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == http.StatusNotFound {
		return TemplateDefinitionVersion{}, ErrTemplateDefinitionVersionNotFound
	}
	if resp.StatusCode/100 != 2 {
		return TemplateDefinitionVersion{}, fmt.Errorf("template definitions get version: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var decoded templateDefinitionVersionResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return TemplateDefinitionVersion{}, err
	}
	return TemplateDefinitionVersion{
		ID:             decoded.Version.ID,
		DefinitionID:   decoded.Version.Definition,
		WorkspaceID:    decoded.Version.Workspace,
		DefinitionJSON: decoded.Version.DefinitionJSON,
	}, nil
}
