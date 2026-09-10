package templating

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRender(t *testing.T) {
	tests := []struct {
		name      string
		content   string
		vars      map[string]string
		want      string
		wantError bool
	}{
		{
			name:    "legacy bare token",
			content: "{{SERVICE_NAME}}",
			vars:    map[string]string{"SERVICE_NAME": "orders"},
			want:    "orders",
		},
		{
			name:    "legacy token with internal whitespace",
			content: "{{ SERVICE_NAME }}",
			vars:    map[string]string{"SERVICE_NAME": "orders"},
			want:    "orders",
		},
		{
			name:    "filter pipe is not bare-token rewritten, dot-prefixed pipe works",
			content: "{{.SERVICE_NAME | pascalCase}}",
			vars:    map[string]string{"SERVICE_NAME": "orders"},
			want:    "Orders",
		},
		{
			name:      "go-template control flow untouched, missing key errors under missingkey=error",
			content:   "{{- if .Values.foo }}bar{{- end }}",
			vars:      map[string]string{"SERVICE_NAME": "orders"},
			wantError: true,
		},
		{
			name:      "unknown variable errors",
			content:   "{{.TYPO}}",
			vars:      map[string]string{"SERVICE_NAME": "orders"},
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Render(tt.content, tt.vars)
			if tt.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestRenderName(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		vars      map[string]string
		want      string
		wantError bool
	}{
		{
			name:  "bare token in file name",
			input: "{{SERVICE_NAME}}-service",
			vars:  map[string]string{"SERVICE_NAME": "orders"},
			want:  "orders-service",
		},
		{
			name:  "no template syntax is unchanged",
			input: "main.go",
			vars:  map[string]string{"SERVICE_NAME": "orders"},
			want:  "main.go",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := RenderName(tt.input, tt.vars)
			if tt.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

// filterPipeNotRewritten is a bare-token-specific regression check for the
// preprocessing regex: `{{SERVICE_NAME | pascalCase}}` (no leading dot) must
// not be rewritten, since the bare-token grammar only matches an exact
// identifier between the braces. It should fail to parse as Go template
// syntax (bare identifier followed by a pipe is not a valid text/template
// action), proving the preprocessor left it alone.
func TestRender_BareTokenWithPipeIsNotRewritten(t *testing.T) {
	_, err := Render("{{SERVICE_NAME | pascalCase}}", map[string]string{"SERVICE_NAME": "orders"})
	require.Error(t, err)
}
