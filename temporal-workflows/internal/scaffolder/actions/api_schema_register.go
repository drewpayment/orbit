package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

//go:embed api_schema_register.input.schema.json
var apiSchemaRegisterInputSchema []byte

//go:embed api_schema_register.output.schema.json
var apiSchemaRegisterOutputSchema []byte

var validApiSchemaTypes = map[string]bool{
	"openapi": true,
	"graphql": true,
	"proto":   true,
}

// ApiSchemaRegister calls orbit-www's internal api-schemas API to register a
// spec-first API schema authored inside a scaffolder run (design §3.5 "spec-
// first API templates"). Mirrors CatalogEntityRegister's shape.
//
// The step input deliberately has no `workspaceId` property: the action
// always registers against rc.WorkspaceID (the run's own workspace, set by
// the dispatch activity), never a value a template author could supply —
// see the phase-3 plan §7 decision 5.
type ApiSchemaRegister struct {
	client ApiSchemaClient
}

// NewApiSchemaRegister constructs the api:schema:register action.
func NewApiSchemaRegister(client ApiSchemaClient) *ApiSchemaRegister {
	return &ApiSchemaRegister{client: client}
}

type apiSchemaRegisterInput struct {
	Name        string `json:"name"`
	SchemaType  string `json:"schemaType"`
	Content     string `json:"content"`
	Description string `json:"description"`
	Visibility  string `json:"visibility"`
}

type apiSchemaRegisterOutput struct {
	SchemaID  string `json:"schemaId"`
	VersionID string `json:"versionId"`
	Slug      string `json:"slug"`
}

// Name implements scaffolder.Action.
func (a *ApiSchemaRegister) Name() string { return "api:schema:register" }

// InputSchema implements scaffolder.Action.
func (a *ApiSchemaRegister) InputSchema() json.RawMessage {
	return apiSchemaRegisterInputSchema
}

// OutputSchema implements scaffolder.Action.
func (a *ApiSchemaRegister) OutputSchema() json.RawMessage {
	return apiSchemaRegisterOutputSchema
}

// Plan describes the schema that would be registered, without doing any I/O.
func (a *ApiSchemaRegister) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseApiSchemaRegisterInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "entity",
		Name:        in.Name,
		Description: fmt.Sprintf("register API schema %q (%s)", in.Name, in.SchemaType),
	}}, nil
}

// Execute registers the schema.
func (a *ApiSchemaRegister) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseApiSchemaRegisterInput(input)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rc.WorkspaceID) == "" {
		return nil, fmt.Errorf("%w: api:schema:register: run context has no workspace", scaffolder.ErrInvalidInput)
	}
	if strings.TrimSpace(rc.UserID) == "" {
		return nil, fmt.Errorf("%w: api:schema:register: run context has no user", scaffolder.ErrInvalidInput)
	}
	if a.client == nil {
		return nil, fmt.Errorf("api:schema:register: no api schema client configured")
	}

	visibility := in.Visibility
	if visibility == "" {
		visibility = "workspace"
	}

	rc.Heartbeat("api:schema:register", in.Name)
	result, err := a.client.RegisterSchema(ctx, services.ApiSchemaRegisterInput{
		WorkspaceID: rc.WorkspaceID,
		UserID:      rc.UserID,
		Name:        in.Name,
		SchemaType:  in.SchemaType,
		Content:     in.Content,
		Description: in.Description,
		Visibility:  visibility,
		Source: services.ApiSchemaSource{
			Type:     "scaffolder-run",
			SourceID: rc.RunID,
		},
	})
	if err != nil {
		// A 4xx (other than the "route not implemented" 404 sentinel) means
		// orbit-www rejected the request as sent — e.g. an unknown
		// workspace, a malformed body. Retrying the identical request would
		// fail identically, so this is a definition problem, not a
		// transient one: wrap it as ErrInvalidInput so the dispatch
		// activity raises it non-retryable instead of burning the retry
		// budget on every attempt.
		if errors.Is(err, services.ErrApiSchemasBadRequest) {
			return nil, fmt.Errorf("api:schema:register: %w: %v", scaffolder.ErrInvalidInput, err)
		}
		return nil, fmt.Errorf("api:schema:register: %w", err)
	}

	return json.Marshal(apiSchemaRegisterOutput{
		SchemaID:  result.SchemaID,
		VersionID: result.VersionID,
		Slug:      result.Slug,
	})
}

func parseApiSchemaRegisterInput(raw json.RawMessage) (apiSchemaRegisterInput, error) {
	var in apiSchemaRegisterInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("%w: api:schema:register: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	for field, v := range map[string]string{
		"name":       in.Name,
		"schemaType": in.SchemaType,
		"content":    in.Content,
	} {
		if strings.TrimSpace(v) == "" {
			return in, fmt.Errorf("%w: api:schema:register: `%s` is required", scaffolder.ErrInvalidInput, field)
		}
	}
	if !validApiSchemaTypes[in.SchemaType] {
		return in, fmt.Errorf("%w: api:schema:register: `schemaType` must be one of openapi, graphql, proto (got %q)", scaffolder.ErrInvalidInput, in.SchemaType)
	}
	if in.Visibility != "" && in.Visibility != "private" && in.Visibility != "workspace" && in.Visibility != "public" {
		return in, fmt.Errorf("%w: api:schema:register: `visibility` must be one of private, workspace, public (got %q)", scaffolder.ErrInvalidInput, in.Visibility)
	}
	return in, nil
}
