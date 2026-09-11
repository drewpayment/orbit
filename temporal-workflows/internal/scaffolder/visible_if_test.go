package scaffolder

import "testing"

// Parity table with orbit-www's ui:visibleIf evaluators (both the SchemaForm
// copy and `lib/scaffolder/visible-if.ts`) — see EvaluateVisibleIf's doc
// comment for why this must stay behaviourally identical to those.
func TestEvaluateVisibleIf(t *testing.T) {
	tests := []struct {
		name   string
		expr   string
		values map[string]any
		want   bool
	}{
		{"empty expression is always visible", "", map[string]any{}, true},
		{"malformed wrapper fails open", "not-a-wrapper", map[string]any{}, true},
		{"empty body fails open", "${{ }}", map[string]any{}, true},

		{"bare truthy ref: true", "${{ parameters.foo }}", map[string]any{"foo": true}, true},
		{"bare truthy ref: false", "${{ parameters.foo }}", map[string]any{"foo": false}, false},
		{"bare truthy ref: missing field is hidden", "${{ parameters.foo }}", map[string]any{}, false},
		{"bare truthy ref: non-empty string is truthy", "${{ parameters.foo }}", map[string]any{"foo": "x"}, true},
		{"bare truthy ref: empty string is falsy", "${{ parameters.foo }}", map[string]any{"foo": ""}, false},
		{"bare truthy ref: nonzero number is truthy", "${{ parameters.foo }}", map[string]any{"foo": float64(1)}, true},
		{"bare truthy ref: zero is falsy", "${{ parameters.foo }}", map[string]any{"foo": float64(0)}, false},
		{"bare ref: not a parameters.* reference fails open", "${{ steps.x.output.y }}", map[string]any{}, true},

		{"negation: true", "${{ !parameters.foo }}", map[string]any{"foo": true}, false},
		{"negation: false", "${{ !parameters.foo }}", map[string]any{"foo": false}, true},
		{"negation: missing field fails open (not a missing-field-hidden case)", "${{ !parameters.foo }}", map[string]any{}, true},

		{"equality: string match", "${{ parameters.env == 'prod' }}", map[string]any{"env": "prod"}, true},
		{"equality: string mismatch", "${{ parameters.env == 'prod' }}", map[string]any{"env": "dev"}, false},
		{"equality: double-quoted literal", `${{ parameters.env == "prod" }}`, map[string]any{"env": "prod"}, true},
		{"equality: number literal", "${{ parameters.replicas == 3 }}", map[string]any{"replicas": float64(3)}, true},
		{"equality: missing field is hidden", "${{ parameters.env == 'prod' }}", map[string]any{}, false},
		{"equality: unrecognizable literal fails open", "${{ parameters.env == parameters.other }}", map[string]any{"env": "x"}, true},
		{"equality: quoted literal with an embedded same-type quote is unrecognizable, fails open", "${{ parameters.env == 'it''s' }}", map[string]any{"env": "it's"}, true},

		{"nested path reference", "${{ parameters.address.city }}", map[string]any{"address": map[string]any{"city": "x"}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EvaluateVisibleIf(tt.expr, tt.values)
			if got != tt.want {
				t.Errorf("EvaluateVisibleIf(%q, %v) = %v, want %v", tt.expr, tt.values, got, tt.want)
			}
		})
	}
}
