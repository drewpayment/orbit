package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeCatalogEntityClient struct {
	result *services.CatalogEntityRegisterResult
	err    error
	got    services.CatalogEntityRegisterInput
}

func (f *fakeCatalogEntityClient) RegisterEntity(_ context.Context, in services.CatalogEntityRegisterInput) (*services.CatalogEntityRegisterResult, error) {
	f.got = in
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

func TestCatalogEntityRegister_Execute(t *testing.T) {
	client := &fakeCatalogEntityClient{result: &services.CatalogEntityRegisterResult{EntityID: "ent-1"}}
	a := NewCatalogEntityRegister(client)

	raw, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"workspaceId":"ws-1","kind":"app","name":"orders","owner":"team-a",`+
			`"links":[{"title":"Repo","url":"https://github.com/acme/orders"}],`+
			`"sourceType":"scaffolder-run","sourceId":"run-1"}`))
	require.NoError(t, err)

	var out catalogEntityRegisterOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "ent-1", out.EntityID)

	assert.Equal(t, "ws-1", client.got.WorkspaceID)
	assert.Equal(t, "app", client.got.Kind)
	assert.Equal(t, "team-a", client.got.Owner)
	require.Len(t, client.got.Links, 1)
	assert.Equal(t, "https://github.com/acme/orders", client.got.Links[0].URL)
	assert.Equal(t, "scaffolder-run", client.got.Source.Type)
	assert.Equal(t, "run-1", client.got.Source.SourceID)
}

func TestCatalogEntityRegister_Execute_TemplateProvenance(t *testing.T) {
	client := &fakeCatalogEntityClient{result: &services.CatalogEntityRegisterResult{EntityID: "ent-1"}}
	a := NewCatalogEntityRegister(client)

	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"workspaceId":"ws-1","kind":"app","name":"orders","sourceType":"scaffolder-run","sourceId":"run-1",`+
			`"templateDefinitionId":"tmpl-1","templateVersionId":"tmpl-1-v2"}`))
	require.NoError(t, err)

	assert.Equal(t, "tmpl-1", client.got.TemplateDefinitionID)
	assert.Equal(t, "tmpl-1-v2", client.got.TemplateVersionID)
}

func TestCatalogEntityRegister_Execute_TemplateProvenanceOptional(t *testing.T) {
	client := &fakeCatalogEntityClient{result: &services.CatalogEntityRegisterResult{EntityID: "ent-1"}}
	a := NewCatalogEntityRegister(client)

	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"workspaceId":"ws-1","kind":"app","name":"orders","sourceType":"scaffolder-run","sourceId":"run-1"}`))
	require.NoError(t, err)

	assert.Empty(t, client.got.TemplateDefinitionID)
	assert.Empty(t, client.got.TemplateVersionID)
}

func TestCatalogEntityRegister_MissingFields(t *testing.T) {
	a := NewCatalogEntityRegister(&fakeCatalogEntityClient{})
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"kind":"app","name":"orders","sourceType":"t","sourceId":"s"}`))
	assert.Error(t, err)
}

func TestCatalogEntityRegister_NoClientConfigured(t *testing.T) {
	a := NewCatalogEntityRegister(nil)
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"workspaceId":"w","kind":"app","name":"orders","sourceType":"t","sourceId":"s"}`))
	assert.ErrorContains(t, err, "no catalog client configured")
}

func TestCatalogEntityRegister_ClientError(t *testing.T) {
	client := &fakeCatalogEntityClient{err: fmt.Errorf("route not implemented")}
	a := NewCatalogEntityRegister(client)
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"workspaceId":"w","kind":"app","name":"orders","sourceType":"t","sourceId":"s"}`))
	assert.ErrorContains(t, err, "route not implemented")
}

func TestCatalogEntityRegister_Plan(t *testing.T) {
	a := NewCatalogEntityRegister(&fakeCatalogEntityClient{})
	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(
		`{"workspaceId":"w","kind":"app","name":"orders","sourceType":"t","sourceId":"s"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "entity", changes[0].Kind)
	assert.Equal(t, "orders", changes[0].Name)
}

func TestCatalogEntityRegister_SchemasAndRegistration(t *testing.T) {
	a := NewCatalogEntityRegister(&fakeCatalogEntityClient{})
	assert.Equal(t, "catalog:entity:register", a.Name())
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	keys, err := r.OutputKeys("catalog:entity:register")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"entityId"}, keys)
}
