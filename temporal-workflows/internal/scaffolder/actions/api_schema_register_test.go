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

func runCtxWorkspace(workspaceID string) scaffolder.ActionRunContext {
	return scaffolder.NewActionRunContext(scaffolder.ActionRunContext{
		RunID:       "run-1",
		WorkspaceID: workspaceID,
		UserID:      "user-1",
	})
}

type fakeApiSchemaClient struct {
	result *services.ApiSchemaRegisterResult
	err    error
	got    services.ApiSchemaRegisterInput
}

func (f *fakeApiSchemaClient) RegisterSchema(_ context.Context, in services.ApiSchemaRegisterInput) (*services.ApiSchemaRegisterResult, error) {
	f.got = in
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

func TestApiSchemaRegister_Execute(t *testing.T) {
	client := &fakeApiSchemaClient{result: &services.ApiSchemaRegisterResult{SchemaID: "schema-1", VersionID: "ver-1", Slug: "orders-api"}}
	a := NewApiSchemaRegister(client)

	raw, err := a.Execute(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"Orders API","schemaType":"openapi","content":"openapi: 3.1.0","description":"desc","visibility":"public"}`))
	require.NoError(t, err)

	var out apiSchemaRegisterOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "schema-1", out.SchemaID)
	assert.Equal(t, "ver-1", out.VersionID)
	assert.Equal(t, "orders-api", out.Slug)

	assert.Equal(t, "ws-1", client.got.WorkspaceID)
	assert.Equal(t, "Orders API", client.got.Name)
	assert.Equal(t, "openapi", client.got.SchemaType)
	assert.Equal(t, "openapi: 3.1.0", client.got.Content)
	assert.Equal(t, "desc", client.got.Description)
	assert.Equal(t, "public", client.got.Visibility)
	assert.Equal(t, "user-1", client.got.UserID)
	assert.Equal(t, "scaffolder-run", client.got.Source.Type)
	assert.Equal(t, "run-1", client.got.Source.SourceID)
}

func TestApiSchemaRegister_DefaultsVisibilityToWorkspace(t *testing.T) {
	client := &fakeApiSchemaClient{result: &services.ApiSchemaRegisterResult{SchemaID: "s", VersionID: "v", Slug: "sl"}}
	a := NewApiSchemaRegister(client)

	_, err := a.Execute(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"Orders API","schemaType":"graphql","content":"type Query { x: Int }"}`))
	require.NoError(t, err)
	assert.Equal(t, "workspace", client.got.Visibility)
}

func TestApiSchemaRegister_UsesRunContextWorkspaceNotInput(t *testing.T) {
	// The input struct has no `workspaceId` field at all, so even if a step's
	// input JSON carries one (e.g. the static validator being bypassed),
	// Execute always registers against rc.WorkspaceID, never a value smuggled
	// in via input.
	client := &fakeApiSchemaClient{result: &services.ApiSchemaRegisterResult{SchemaID: "s", VersionID: "v", Slug: "sl"}}
	a := NewApiSchemaRegister(client)

	_, err := a.Execute(context.Background(), runCtxWorkspace("ws-real"), json.RawMessage(
		`{"name":"Orders API","schemaType":"proto","content":"syntax = \"proto3\";","workspaceId":"ws-attacker"}`))
	require.NoError(t, err)
	assert.Equal(t, "ws-real", client.got.WorkspaceID)
}

func TestApiSchemaRegister_MissingFields(t *testing.T) {
	a := NewApiSchemaRegister(&fakeApiSchemaClient{})
	_, err := a.Execute(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(`{"schemaType":"openapi","content":"x"}`))
	assert.Error(t, err)
}

func TestApiSchemaRegister_MissingWorkspaceOnRunContext(t *testing.T) {
	a := NewApiSchemaRegister(&fakeApiSchemaClient{})
	_, err := a.Execute(context.Background(), runCtxWorkspace(""), json.RawMessage(
		`{"name":"n","schemaType":"openapi","content":"c"}`))
	assert.ErrorContains(t, err, "workspace")
}

func TestApiSchemaRegister_MissingUserOnRunContext(t *testing.T) {
	a := NewApiSchemaRegister(&fakeApiSchemaClient{})
	rc := scaffolder.NewActionRunContext(scaffolder.ActionRunContext{RunID: "run-1", WorkspaceID: "ws-1"})
	_, err := a.Execute(context.Background(), rc, json.RawMessage(
		`{"name":"n","schemaType":"openapi","content":"c"}`))
	assert.ErrorContains(t, err, "user")
}

func TestApiSchemaRegister_InvalidSchemaType(t *testing.T) {
	a := NewApiSchemaRegister(&fakeApiSchemaClient{})
	_, err := a.Execute(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"n","schemaType":"yaml","content":"c"}`))
	assert.ErrorContains(t, err, "schemaType")
}

func TestApiSchemaRegister_NoClientConfigured(t *testing.T) {
	a := NewApiSchemaRegister(nil)
	_, err := a.Execute(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"n","schemaType":"openapi","content":"c"}`))
	assert.ErrorContains(t, err, "no api schema client configured")
}

func TestApiSchemaRegister_ClientError(t *testing.T) {
	client := &fakeApiSchemaClient{err: fmt.Errorf("route not implemented")}
	a := NewApiSchemaRegister(client)
	_, err := a.Execute(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"n","schemaType":"openapi","content":"c"}`))
	assert.ErrorContains(t, err, "route not implemented")
}

func TestApiSchemaRegister_Plan(t *testing.T) {
	a := NewApiSchemaRegister(&fakeApiSchemaClient{})
	changes, err := a.Plan(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"Orders API","schemaType":"openapi","content":"c"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "entity", changes[0].Kind)
	assert.Equal(t, "Orders API", changes[0].Name)
}

func TestApiSchemaRegister_PlanDoesNotTouchClient(t *testing.T) {
	// Plan must have no I/O — nil client must not error.
	a := NewApiSchemaRegister(nil)
	_, err := a.Plan(context.Background(), runCtxWorkspace("ws-1"), json.RawMessage(
		`{"name":"n","schemaType":"openapi","content":"c"}`))
	require.NoError(t, err)
}

func TestApiSchemaRegister_SchemasAndRegistration(t *testing.T) {
	a := NewApiSchemaRegister(&fakeApiSchemaClient{})
	assert.Equal(t, "api:schema:register", a.Name())
	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	keys, err := r.OutputKeys("api:schema:register")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"schemaId", "versionId", "slug"}, keys)
}

func TestApiSchemaRegister_InputSchemaHasNoWorkspaceIdProperty(t *testing.T) {
	a := NewApiSchemaRegister(nil)
	var schema struct {
		Properties map[string]json.RawMessage `json:"properties"`
	}
	require.NoError(t, json.Unmarshal(a.InputSchema(), &schema))
	_, hasWorkspaceID := schema.Properties["workspaceId"]
	assert.False(t, hasWorkspaceID, "workspaceId must not be a template-author input; the action uses rc.WorkspaceID")
}
