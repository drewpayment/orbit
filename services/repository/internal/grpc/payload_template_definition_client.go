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

// Accepted document identifiers. Duplicated from
// temporal-workflows/internal/scaffolder (not importable across the module
// boundary) so a v1 or malformed document is rejected at dispatch time with a
// clear message, rather than deep inside the workflow after the run record has
// already flipped to running.
const (
	definitionAPIVersionV2 = "orbit/v2"
	definitionKindTemplate = "Template"
)

// checkDefinitionHeader rejects a stored document the v2 engine cannot run.
// The body is otherwise passed through untouched: this service does not
// interpret template definitions.
func checkDefinitionHeader(versionID string, raw json.RawMessage) error {
	var header struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return fmt.Errorf("get template definition version %s: definitionJson is not an object: %w", versionID, err)
	}
	if header.APIVersion != definitionAPIVersionV2 {
		return fmt.Errorf("get template definition version %s: unsupported apiVersion %q, want %q",
			versionID, header.APIVersion, definitionAPIVersionV2)
	}
	if header.Kind != definitionKindTemplate {
		return fmt.Errorf("get template definition version %s: unsupported kind %q, want %q",
			versionID, header.Kind, definitionKindTemplate)
	}
	return nil
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
		// Same distinction as the action-runs client: a framework 404 means
		// the route is not deployed, not that the version is missing.
		if !isJSONErrorBody(body) {
			return nil, ErrIdentityRouteUnavailable
		}
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
	if err := checkDefinitionHeader(versionID, env.Version.DefinitionJSON); err != nil {
		return nil, err
	}

	return &TemplateDefinitionVersionData{
		ID:             env.Version.ID,
		DefinitionID:   env.Version.Definition,
		WorkspaceID:    env.Version.Workspace,
		VersionNumber:  env.Version.VersionNumber,
		DefinitionJSON: env.Version.DefinitionJSON,
	}, nil
}
