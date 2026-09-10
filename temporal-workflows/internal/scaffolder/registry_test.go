package scaffolder

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeAction struct {
	name    string
	family  string
	in, out string
	noPlan  bool
}

func (f *fakeAction) Name() string                  { return f.name }
func (f *fakeAction) InputSchema() json.RawMessage  { return json.RawMessage(f.in) }
func (f *fakeAction) OutputSchema() json.RawMessage { return json.RawMessage(f.out) }
func (f *fakeAction) Execute(context.Context, ActionRunContext, json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}
func (f *fakeAction) Plan(context.Context, ActionRunContext, json.RawMessage) ([]PlannedChange, error) {
	if f.noPlan {
		return nil, ErrNoPlan
	}
	return []PlannedChange{{Kind: "file", Name: f.name}}, nil
}

type fakeNoPlanAction struct{ fakeAction }

func (f *fakeNoPlanAction) SupportsPlan() bool { return false }

type fakeFamilyAction struct{ fakeAction }

func (f *fakeFamilyAction) Family() string { return "custom-family" }

func TestRegistryGet(t *testing.T) {
	a := &fakeAction{name: "debug:log", in: `{"type":"object"}`, out: `{"type":"object"}`}
	r := NewRegistry(a)

	got, ok := r.Get("debug:log")
	require.True(t, ok)
	assert.Same(t, a, got)

	_, ok = r.Get("nope:missing")
	assert.False(t, ok)
}

func TestNewRegistryPanicsOnDuplicate(t *testing.T) {
	a := &fakeAction{name: "debug:log"}
	b := &fakeAction{name: "debug:log"}
	assert.Panics(t, func() { NewRegistry(a, b) })
}

func TestNewRegistryPanicsOnEmptyName(t *testing.T) {
	assert.Panics(t, func() { NewRegistry(&fakeAction{name: ""}) })
}

func TestRegistryDescriptors(t *testing.T) {
	r := NewRegistry(
		&fakeAction{name: "github:repo:create", in: `{"type":"object"}`, out: `{"type":"object","properties":{"repoUrl":{"type":"string"}}}`},
		&fakeAction{name: "debug:log", in: `{"type":"object"}`, out: `{"type":"object"}`},
		&fakeNoPlanAction{fakeAction{name: "http:request", in: `{"type":"object"}`, out: `{"type":"object"}`}},
		&fakeFamilyAction{fakeAction{name: "weird", in: `{"type":"object"}`, out: `{"type":"object"}`}},
	)

	ds := r.Descriptors()
	require.Len(t, ds, 4)
	// deterministic, sorted by name
	assert.Equal(t, []string{"debug:log", "github:repo:create", "http:request", "weird"}, r.Names())
	assert.Equal(t, "debug:log", ds[0].Name)

	assert.Equal(t, "github", ds[1].Family)
	assert.True(t, ds[1].SupportsPlan)
	assert.Equal(t, "http", ds[2].Family)
	assert.False(t, ds[2].SupportsPlan, "SupportsPlan() override must be honoured")
	assert.Equal(t, "custom-family", ds[3].Family, "Family() override must be honoured")

	d, ok := r.Descriptor("github:repo:create")
	require.True(t, ok)
	assert.JSONEq(t, `{"type":"object","properties":{"repoUrl":{"type":"string"}}}`, string(d.OutputSchema))

	_, ok = r.Descriptor("nope")
	assert.False(t, ok)
}

func TestRegistryOutputKeys(t *testing.T) {
	r := NewRegistry(&fakeAction{
		name: "github:repo:create",
		in:   `{"type":"object"}`,
		out:  `{"type":"object","properties":{"repoUrl":{"type":"string"},"repoName":{"type":"string"}}}`,
	}, &fakeAction{name: "no:schema", in: `{}`, out: `{}`})

	keys, err := r.OutputKeys("github:repo:create")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"repoUrl", "repoName"}, keys)

	keys, err = r.OutputKeys("no:schema")
	require.NoError(t, err)
	assert.Empty(t, keys)

	_, err = r.OutputKeys("missing:action")
	assert.Error(t, err)
}

func TestDescriptorsAreCopies(t *testing.T) {
	r := NewRegistry(&fakeAction{name: "a:b", in: `{"type":"object"}`, out: `{"type":"object"}`})
	first := r.Descriptors()
	first[0].Name = "mutated"
	second := r.Descriptors()
	assert.Equal(t, "a:b", second[0].Name, "Descriptors() must not hand out shared state")
}

func TestFamilyFromName(t *testing.T) {
	assert.Equal(t, "github", familyFromName("github:repo:create"))
	assert.Equal(t, "fs", familyFromName("fs:render"))
	assert.Equal(t, "debug", familyFromName("debug:log"))
	assert.Equal(t, "plain", familyFromName("plain"))
	assert.Equal(t, "", familyFromName(""))
}

func TestNewRegistryPanicsOnNilAction(t *testing.T) {
	assert.Panics(t, func() { NewRegistry(nil) })
}

func TestRegistryValidateSchemas(t *testing.T) {
	ok := NewRegistry(&fakeAction{name: "a:b", in: `{"type":"object"}`, out: `{"type":"object"}`})
	assert.NoError(t, ok.ValidateSchemas())

	assert.Error(t, NewRegistry(&fakeAction{name: "a:b", in: `{"type":`, out: `{}`}).ValidateSchemas())
	assert.Error(t, NewRegistry(&fakeAction{name: "a:b", in: ``, out: `{}`}).ValidateSchemas())
	assert.Error(t, NewRegistry(&fakeAction{name: "a:b", in: `{"type":"object"}`, out: `{"type":5}`}).ValidateSchemas())
}
