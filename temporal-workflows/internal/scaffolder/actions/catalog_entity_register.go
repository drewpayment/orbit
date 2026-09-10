package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

//go:embed catalog_entity_register.input.schema.json
var catalogEntityRegisterInputSchema []byte

//go:embed catalog_entity_register.output.schema.json
var catalogEntityRegisterOutputSchema []byte

// CatalogEntityRegister calls orbit-www's internal catalog-entities API to
// register the result of a scaffolder run as a catalog entity.
//
// The API this wraps (POST /api/internal/catalog-entities) does not exist in
// orbit-www yet — see services.PayloadCatalogEntityClient's doc comment for
// the proposed contract. This action is still registered and unit-tested
// against a fake CatalogEntityClient; wiring a real client is blocked on
// orbit-www implementing the route.
type CatalogEntityRegister struct {
	client CatalogEntityClient
}

// NewCatalogEntityRegister constructs the catalog:entity:register action.
func NewCatalogEntityRegister(client CatalogEntityClient) *CatalogEntityRegister {
	return &CatalogEntityRegister{client: client}
}

type catalogEntityLinkInput struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type catalogEntityRegisterInput struct {
	WorkspaceID string                   `json:"workspaceId"`
	Kind        string                   `json:"kind"`
	Name        string                   `json:"name"`
	Owner       string                   `json:"owner"`
	Links       []catalogEntityLinkInput `json:"links"`
	SourceType  string                   `json:"sourceType"`
	SourceID    string                   `json:"sourceId"`
}

type catalogEntityRegisterOutput struct {
	EntityID string `json:"entityId"`
}

// Name implements scaffolder.Action.
func (a *CatalogEntityRegister) Name() string { return "catalog:entity:register" }

// InputSchema implements scaffolder.Action.
func (a *CatalogEntityRegister) InputSchema() json.RawMessage {
	return catalogEntityRegisterInputSchema
}

// OutputSchema implements scaffolder.Action.
func (a *CatalogEntityRegister) OutputSchema() json.RawMessage {
	return catalogEntityRegisterOutputSchema
}

// Plan describes the entity that would be registered, without registering it.
func (a *CatalogEntityRegister) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseCatalogEntityRegisterInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "entity",
		Name:        in.Name,
		Description: fmt.Sprintf("register catalog entity %q (kind %s)", in.Name, in.Kind),
	}}, nil
}

// Execute registers the entity.
func (a *CatalogEntityRegister) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseCatalogEntityRegisterInput(input)
	if err != nil {
		return nil, err
	}
	if a.client == nil {
		return nil, fmt.Errorf("catalog:entity:register: no catalog client configured")
	}

	links := make([]services.CatalogEntityLink, 0, len(in.Links))
	for _, l := range in.Links {
		links = append(links, services.CatalogEntityLink{Title: l.Title, URL: l.URL})
	}

	rc.Heartbeat("catalog:entity:register", in.Name)
	result, err := a.client.RegisterEntity(ctx, services.CatalogEntityRegisterInput{
		WorkspaceID: in.WorkspaceID,
		Kind:        in.Kind,
		Name:        in.Name,
		Owner:       in.Owner,
		Links:       links,
		Source: services.CatalogEntitySource{
			Type:     in.SourceType,
			SourceID: in.SourceID,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("catalog:entity:register: %w", err)
	}

	return json.Marshal(catalogEntityRegisterOutput{EntityID: result.EntityID})
}

func parseCatalogEntityRegisterInput(raw json.RawMessage) (catalogEntityRegisterInput, error) {
	var in catalogEntityRegisterInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("catalog:entity:register: decode input: %w", err)
		}
	}
	for field, v := range map[string]string{
		"workspaceId": in.WorkspaceID,
		"kind":        in.Kind,
		"name":        in.Name,
		"sourceType":  in.SourceType,
		"sourceId":    in.SourceID,
	} {
		if strings.TrimSpace(v) == "" {
			return in, fmt.Errorf("catalog:entity:register: `%s` is required", field)
		}
	}
	return in, nil
}
