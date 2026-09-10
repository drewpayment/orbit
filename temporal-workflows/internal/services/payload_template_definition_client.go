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

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// TemplateDefinitionVersion is one immutable snapshot of a v2 template
// document, as returned by GET /api/internal/template-definition-versions/{id}.
type TemplateDefinitionVersion struct {
	ID            string
	DefinitionID  string
	WorkspaceID   string
	VersionNumber int
	Definition    scaffolder.Definition
}

// templateDefinitionVersionEnvelope mirrors the route's response body. It is
// shaped exactly like the patterns by-id route: a single named key holding the
// document, so the route can grow sibling keys without breaking this decoder.
type templateDefinitionVersionEnvelope struct {
	Version struct {
		ID             string          `json:"id"`
		Definition     string          `json:"definition"`
		Workspace      string          `json:"workspace"`
		VersionNumber  int             `json:"versionNumber"`
		DefinitionJSON json.RawMessage `json:"definitionJson"`
	} `json:"version"`
}

// ErrTemplateDefinitionVersionNotFound is returned when a version id doesn't
// resolve. The gRPC layer maps it to CodeNotFound so a stale link reads as a
// user error rather than a platform failure.
var ErrTemplateDefinitionVersionNotFound = errors.New("template definition version not found")

// PayloadTemplateDefinitionClient reads template definition versions from
// orbit-www's internal API. Mirrors PayloadTemplateClient's shape.
type PayloadTemplateDefinitionClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadTemplateDefinitionClient builds a client against orbit-www's base URL.
func NewPayloadTemplateDefinitionClient(baseURL, apiKey string, logger *slog.Logger) *PayloadTemplateDefinitionClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadTemplateDefinitionClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// GetVersion calls GET {baseURL}/api/internal/template-definition-versions/{id}
// and decodes the stored v2 document. The apiVersion/kind check happens here so
// a malformed or v1 document fails at dispatch time with a clear message rather
// than deep inside the workflow.
func (c *PayloadTemplateDefinitionClient) GetVersion(ctx context.Context, versionID string) (*TemplateDefinitionVersion, error) {
	if versionID == "" {
		return nil, errors.New("template definition version id required")
	}

	u := c.baseURL + "/api/internal/template-definition-versions/" + url.PathEscape(versionID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrTemplateDefinitionVersionNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("get template definition version: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var env templateDefinitionVersionEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("get template definition version: decode response: %w", err)
	}
	if len(env.Version.DefinitionJSON) == 0 || string(env.Version.DefinitionJSON) == "null" {
		return nil, fmt.Errorf("get template definition version %s: definitionJson is empty", versionID)
	}

	var def scaffolder.Definition
	if err := json.Unmarshal(env.Version.DefinitionJSON, &def); err != nil {
		return nil, fmt.Errorf("get template definition version %s: decode definitionJson: %w", versionID, err)
	}
	if def.APIVersion != scaffolder.APIVersionV2 {
		return nil, fmt.Errorf("get template definition version %s: unsupported apiVersion %q, want %q", versionID, def.APIVersion, scaffolder.APIVersionV2)
	}
	if def.Kind != scaffolder.KindTemplate {
		return nil, fmt.Errorf("get template definition version %s: unsupported kind %q, want %q", versionID, def.Kind, scaffolder.KindTemplate)
	}

	return &TemplateDefinitionVersion{
		ID:            env.Version.ID,
		DefinitionID:  env.Version.Definition,
		WorkspaceID:   env.Version.Workspace,
		VersionNumber: env.Version.VersionNumber,
		Definition:    def,
	}, nil
}
