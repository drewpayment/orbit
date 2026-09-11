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

// Parity table with orbit-www/src/lib/scaffolder/defaults.test.ts's
// "applyParameterDefaults respects ui:visibleIf" describe block — same case
// names/inputs, run in both languages, so the TS and Go implementations
// can't silently drift.
func TestApplyParameterDefaultsRespectsVisibleIf(t *testing.T) {
	visibleIfPage := func(t *testing.T, controllingDefault string) ParameterPage {
		t.Helper()
		enableExtra := `{"type":"boolean"}`
		if controllingDefault != "" {
			enableExtra = `{"type":"boolean","default":` + controllingDefault + `}`
		}
		return page(t, "Page 1", map[string]string{
			"enableExtra": enableExtra,
			"extra":       `{"type":"string","default":"extra-default","ui:visibleIf":"${{ parameters.enableExtra }}"}`,
		})
	}

	t.Run("a hidden field with a default is NOT present in the output", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{visibleIfPage(t, "")}}}
		got := ApplyParameterDefaults(def, map[string]any{})
		assert.Equal(t, map[string]any{}, got)
		_, hasExtra := got["extra"]
		assert.False(t, hasExtra)
	})

	t.Run("the field becomes present, with its default, once the controlling boolean is explicitly true", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{visibleIfPage(t, "")}}}
		got := ApplyParameterDefaults(def, map[string]any{"enableExtra": true})
		assert.Equal(t, map[string]any{"enableExtra": true, "extra": "extra-default"}, got)
	})

	t.Run("stays hidden when the controlling boolean is explicitly false", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{visibleIfPage(t, "")}}}
		got := ApplyParameterDefaults(def, map[string]any{"enableExtra": false})
		assert.Equal(t, map[string]any{"enableExtra": false}, got)
	})

	t.Run("an explicit caller-provided value for a currently-hidden field is left alone (not dropped)", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{visibleIfPage(t, "")}}}
		got := ApplyParameterDefaults(def, map[string]any{"enableExtra": false, "extra": "explicit"})
		assert.Equal(t, map[string]any{"enableExtra": false, "extra": "explicit"}, got)
	})

	t.Run("the controlling field can itself come from a default", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{visibleIfPage(t, "true")}}}
		got := ApplyParameterDefaults(def, map[string]any{})
		assert.Equal(t, map[string]any{"enableExtra": true, "extra": "extra-default"}, got)
	})

	t.Run("respects a negated visibleIf expression", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{
			page(t, "Page 1", map[string]string{
				"useDefault": `{"type":"boolean"}`,
				"customName": `{"type":"string","default":"auto-name","ui:visibleIf":"${{ !parameters.useDefault }}"}`,
			}),
		}}}
		assert.Equal(t, map[string]any{"useDefault": true}, ApplyParameterDefaults(def, map[string]any{"useDefault": true}))
		assert.Equal(t, map[string]any{"useDefault": false, "customName": "auto-name"}, ApplyParameterDefaults(def, map[string]any{"useDefault": false}))
	})

	t.Run("respects an equality visibleIf expression", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{
			page(t, "Page 1", map[string]string{
				"env":      `{"type":"string"}`,
				"replicas": `{"type":"integer","default":3,"ui:visibleIf":"${{ parameters.env == 'prod' }}"}`,
			}),
		}}}
		assert.Equal(t, map[string]any{"env": "dev"}, ApplyParameterDefaults(def, map[string]any{"env": "dev"}))
		assert.Equal(t, map[string]any{"env": "prod", "replicas": float64(3)}, ApplyParameterDefaults(def, map[string]any{"env": "prod"}))
	})

	// The A -> C chain: C's visibleIf references A, and A ITSELF gets
	// dropped (A's own visibleIf, gated on `controller`, evaluates false).
	// C must still evaluate against A's DEFAULTED value — not against
	// whatever A ends up as in the final (post-drop) result — regardless of
	// which order the two properties happen to be processed in. Run many
	// times: Go's map iteration order is randomized per-iteration, so a
	// regression back to evaluating against the mutating `out` map (instead
	// of a frozen snapshot) would be expected to flip the result across
	// enough repetitions.
	t.Run("a field's visibleIf evaluates against another newly-defaulted field's value even when that field is itself dropped (order-independent)", func(t *testing.T) {
		def := Definition{Spec: Spec{Parameters: []ParameterPage{
			page(t, "Page 1", map[string]string{
				"controller": `{"type":"boolean"}`,
				"a":          `{"type":"string","default":"a-value","ui:visibleIf":"${{ parameters.controller }}"}`,
				"c":          `{"type":"string","default":"c-value","ui:visibleIf":"${{ parameters.a }}"}`,
			}),
		}}}
		want := map[string]any{"controller": false, "c": "c-value"}
		for i := 0; i < 200; i++ {
			got := ApplyParameterDefaults(def, map[string]any{"controller": false})
			require.Equal(t, want, got, "iteration %d", i)
		}
	})
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
