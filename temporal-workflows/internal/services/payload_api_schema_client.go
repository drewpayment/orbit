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

// ApiSchemaSource identifies what produced a registered API schema.
type ApiSchemaSource struct {
	// Type is the producer kind, e.g. "scaffolder-run".
	Type string `json:"type"`
	// SourceID identifies the specific producer, e.g. the scaffolder run id.
	SourceID string `json:"sourceId"`
}

// ApiSchemaRegisterInput is the body of POST /api/internal/api-schemas.
type ApiSchemaRegisterInput struct {
	WorkspaceID string          `json:"workspaceId"`
	// UserID is the Payload `users` id recorded as `createdBy` on the
	// created api-schemas/api-schema-versions rows — both fields are
	// required on those collections with no default outside a request
	// context. Sourced from rc.UserID (the run's initiating user), never
	// from the step's `input`.
	UserID      string          `json:"userId"`
	Name        string          `json:"name"`
	SchemaType  string          `json:"schemaType"`
	Content     string          `json:"content"`
	Description string          `json:"description,omitempty"`
	Visibility  string          `json:"visibility,omitempty"`
	Source      ApiSchemaSource `json:"source"`
}

// ApiSchemaRegisterResult is the response of POST /api/internal/api-schemas.
type ApiSchemaRegisterResult struct {
	SchemaID  string `json:"schemaId"`
	VersionID string `json:"versionId"`
	Slug      string `json:"slug"`
}

// ErrApiSchemasAPINotImplemented is returned when the internal api-schemas
// registration route hasn't been deployed yet (HTTP 404).
var ErrApiSchemasAPINotImplemented = errors.New("orbit-www has no POST /api/internal/api-schemas route yet")

// PayloadApiSchemaClient calls orbit-www's internal API to register an API
// schema produced by a scaffolder run (the api:schema:register action).
//
// CONTRACT:
//
//	POST {baseURL}/api/internal/api-schemas
//	Header: X-API-Key: <ORBIT_INTERNAL_API_KEY>
//	Body:   ApiSchemaRegisterInput (JSON)
//	201:    ApiSchemaRegisterResult (JSON)
//	404:    route not implemented — surfaced as ErrApiSchemasAPINotImplemented
//
// Idempotent on (workspaceId, source.type, source.sourceId, name), same
// convention as PayloadCatalogEntityClient / catalog-entities.
type PayloadApiSchemaClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadApiSchemaClient constructs the client.
func NewPayloadApiSchemaClient(baseURL, apiKey string, logger *slog.Logger) *PayloadApiSchemaClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadApiSchemaClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// RegisterSchema calls POST {baseURL}/api/internal/api-schemas.
func (c *PayloadApiSchemaClient) RegisterSchema(ctx context.Context, in ApiSchemaRegisterInput) (*ApiSchemaRegisterResult, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspace id required")
	}
	if in.UserID == "" {
		return nil, errors.New("user id required")
	}
	if in.Name == "" {
		return nil, errors.New("name required")
	}
	if in.SchemaType == "" {
		return nil, errors.New("schemaType required")
	}
	if in.Content == "" {
		return nil, errors.New("content required")
	}

	body, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}

	u := c.baseURL + "/api/internal/api-schemas"
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
		return nil, ErrApiSchemasAPINotImplemented
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("register api schema: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out ApiSchemaRegisterResult
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
