package scaffolder

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func page(t *testing.T, title string, properties map[string]string) ParameterPage {
	t.Helper()
	props := make(map[string]json.RawMessage, len(properties))
	for name, raw := range properties {
		props[name] = json.RawMessage(raw)
	}
	return ParameterPage{Title: title, Properties: props}
}

func TestApplyParameterDefaults(t *testing.T) {
	tests := []struct {
		name   string
		def    Definition
		params map[string]any
		want   map[string]any
	}{
		{
			name: "fills a missing string default",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"repoName": `{"type":"string","default":"my-repo"}`,
				}),
			}}},
			params: map[string]any{},
			want:   map[string]any{"repoName": "my-repo"},
		},
		{
			name: "fills a missing boolean default",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"private": `{"type":"boolean","default":true}`,
				}),
			}}},
			params: map[string]any{},
			want:   map[string]any{"private": true},
		},
		{
			name: "never overrides a provided value, including an explicit false",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"private": `{"type":"boolean","default":true}`,
				}),
			}}},
			params: map[string]any{"private": false},
			want:   map[string]any{"private": false},
		},
		{
			name: "never overrides an explicit empty string or zero",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"repoName": `{"type":"string","default":"my-repo"}`,
					"replicas": `{"type":"integer","default":3}`,
				}),
			}}},
			params: map[string]any{"repoName": "", "replicas": float64(0)},
			want:   map[string]any{"repoName": "", "replicas": float64(0)},
		},
		{
			name: "a property with no declared default is left absent",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"repoName": `{"type":"string"}`,
				}),
			}}},
			params: map[string]any{},
			want:   map[string]any{},
		},
		{
			name: "merges defaults across multiple pages",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{"a": `{"type":"string","default":"a-default"}`}),
				page(t, "Page 2", map[string]string{"b": `{"type":"string","default":"b-default"}`}),
			}}},
			params: map[string]any{"a": "explicit-a"},
			want:   map[string]any{"a": "explicit-a", "b": "b-default"},
		},
		{
			name: "fills defaults inside a nested object property",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"address": `{"type":"object","properties":{"city":{"type":"string","default":"Anytown"}}}`,
				}),
			}}},
			params: map[string]any{},
			want:   map[string]any{"address": map[string]any{"city": "Anytown"}},
		},
		{
			name: "does not override an explicit key inside a nested object",
			def: Definition{Spec: Spec{Parameters: []ParameterPage{
				page(t, "Page 1", map[string]string{
					"address": `{"type":"object","properties":{"city":{"type":"string","default":"Anytown"}}}`,
				}),
			}}},
			params: map[string]any{"address": map[string]any{"city": "Realtown"}},
			want:   map[string]any{"address": map[string]any{"city": "Realtown"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ApplyParameterDefaults(tt.def, tt.params)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestApplyParameterDefaultsDoesNotMutateInput(t *testing.T) {
	def := Definition{Spec: Spec{Parameters: []ParameterPage{
		page(t, "Page 1", map[string]string{"repoName": `{"type":"string","default":"my-repo"}`}),
	}}}
	params := map[string]any{}
	_ = ApplyParameterDefaults(def, params)
	assert.Empty(t, params, "ApplyParameterDefaults must not mutate the caller's map")
}

func TestApplyParameterDefaultsDoesNotMutateNestedInput(t *testing.T) {
	def := Definition{Spec: Spec{Parameters: []ParameterPage{
		page(t, "Page 1", map[string]string{
			"address": `{"type":"object","properties":{"city":{"type":"string","default":"Anytown"}}}`,
		}),
	}}}
	params := map[string]any{"address": map[string]any{"unrelated": 1}}

	got := ApplyParameterDefaults(def, params)

	// The returned result gets the default filled in...
	assert.Equal(t, map[string]any{"unrelated": 1, "city": "Anytown"}, got["address"])
	// ...but the caller's own nested map must be untouched.
	address, ok := params["address"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, map[string]any{"unrelated": 1}, address)
	_, hasCity := address["city"]
	assert.False(t, hasCity, "ApplyParameterDefaults must not write into the caller's nested map")
}
