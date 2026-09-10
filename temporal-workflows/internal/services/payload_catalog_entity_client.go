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
	"time"
)

// CatalogEntitySource identifies what produced a registered catalog entity.
type CatalogEntitySource struct {
	// Type is the producer kind, e.g. "scaffolder-run".
	Type string `json:"type"`
	// SourceID identifies the specific producer, e.g. the scaffolder run id.
	SourceID string `json:"sourceId"`
}

// CatalogEntityLink is one link shown on the registered entity's catalog
// page.
type CatalogEntityLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// CatalogEntityRegisterInput is the body of
// POST /api/internal/catalog-entities.
type CatalogEntityRegisterInput struct {
	WorkspaceID string              `json:"workspaceId"`
	Kind        string              `json:"kind"`
	Name        string              `json:"name"`
	Owner       string              `json:"owner,omitempty"`
	Links       []CatalogEntityLink `json:"links,omitempty"`
	Source      CatalogEntitySource `json:"source"`
}

// CatalogEntityRegisterResult is the response of
// POST /api/internal/catalog-entities.
type CatalogEntityRegisterResult struct {
	EntityID string `json:"entityId"`
}

// ErrCatalogEntitiesAPINotImplemented is returned when the internal
// catalog-entities registration route hasn't been deployed yet (HTTP 404).
// The route does not exist in orbit-www as of this client's introduction —
// see the doc comment on PayloadCatalogEntityClient.
var ErrCatalogEntitiesAPINotImplemented = errors.New("orbit-www has no POST /api/internal/catalog-entities route yet")

// PayloadCatalogEntityClient calls orbit-www's internal API to register a
// catalog entity produced by a scaffolder run (the catalog:entity:register
// action).
//
// CONTRACT (proposed by Phase 1 of the template-authoring engine work;
// NOT YET IMPLEMENTED server-side as of this client landing — see the PR
// description that introduced this file):
//
//	POST {baseURL}/api/internal/catalog-entities
//	Header: X-API-Key: <ORBIT_INTERNAL_API_KEY>   (see internal-api-auth.ts,
//	        same convention as PayloadTemplateClient's finalize call)
//	Body:   CatalogEntityRegisterInput (JSON)
//	201:    CatalogEntityRegisterResult (JSON)
//	404:    route not implemented — surfaced as ErrCatalogEntitiesAPINotImplemented
//
// Until orbit-www implements this route, catalog:entity:register will fail
// every real run; it is still safe to register in the action registry and
// exercise in tests against a fake CatalogEntityClient.
type PayloadCatalogEntityClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadCatalogEntityClient constructs the client.
func NewPayloadCatalogEntityClient(baseURL, apiKey string, logger *slog.Logger) *PayloadCatalogEntityClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadCatalogEntityClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// RegisterEntity calls POST {baseURL}/api/internal/catalog-entities.
func (c *PayloadCatalogEntityClient) RegisterEntity(ctx context.Context, in CatalogEntityRegisterInput) (*CatalogEntityRegisterResult, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspace id required")
	}
	if in.Kind == "" {
		return nil, errors.New("kind required")
	}
	if in.Name == "" {
		return nil, errors.New("name required")
	}

	body, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}

	u := c.baseURL + "/api/internal/catalog-entities"
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
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrCatalogEntitiesAPINotImplemented
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("register catalog entity: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out CatalogEntityRegisterResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
