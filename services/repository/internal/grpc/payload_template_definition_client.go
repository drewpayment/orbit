package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// TemplateDefinitionVersionData is one immutable snapshot of a v2 template
// document. DefinitionJSON is passed through to the workflow verbatim: this
// service never interprets the document.
type TemplateDefinitionVersionData struct {
	ID             string
	DefinitionID   string
	WorkspaceID    string
	VersionNumber  int
	DefinitionJSON json.RawMessage
}

// TemplateDefinitionClientInterface reads stored template definition versions.
// StartScaffolderRun needs the document because StartScaffolderRunRequest
// carries only ids.
type TemplateDefinitionClientInterface interface {
	GetDefinitionVersion(ctx context.Context, versionID string) (*TemplateDefinitionVersionData, error)
}

// ErrTemplateDefinitionVersionNotFound is returned when a version id doesn't
// resolve, so the handler can answer NotFound rather than Internal.
var ErrTemplateDefinitionVersionNotFound = errors.New("template definition version not found")

// PayloadTemplateDefinitionClient reads template definition versions from
// orbit-www's internal API.
//
// The equivalent client in temporal-workflows/internal/services cannot be
// reused: internal packages do not cross the module boundary. Both decode the
// same envelope, documented on this type.
//
// Contract: GET {baseURL}/api/internal/template-definition-versions/{id}
// with an X-API-Key header, answering
//
//	{"version":{"id":…,"definition":…,"workspace":…,"versionNumber":…,"definitionJson":{…}}}
//
// and 404 with {"error":…} when the id does not resolve.
type PayloadTemplateDefinitionClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPayloadTemplateDefinitionClient builds a client against orbit-www.
func NewPayloadTemplateDefinitionClient(baseURL, apiKey string) *PayloadTemplateDefinitionClient {
	return &PayloadTemplateDefinitionClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

type templateDefinitionVersionEnvelope struct {
	Version struct {
		ID             string          `json:"id"`
		Definition     string          `json:"definition"`
		Workspace      string          `json:"workspace"`
		VersionNumber  int             `json:"versionNumber"`
		DefinitionJSON json.RawMessage `json:"definitionJson"`
	} `json:"version"`
}

// GetDefinitionVersion fetches one stored version.
func (c *PayloadTemplateDefinitionClient) GetDefinitionVersion(ctx context.Context, versionID string) (*TemplateDefinitionVersionData, error) {
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

	return &TemplateDefinitionVersionData{
		ID:             env.Version.ID,
		DefinitionID:   env.Version.Definition,
		WorkspaceID:    env.Version.Workspace,
		VersionNumber:  env.Version.VersionNumber,
		DefinitionJSON: env.Version.DefinitionJSON,
	}, nil
}
