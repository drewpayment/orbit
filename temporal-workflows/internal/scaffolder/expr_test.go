package scaffolder

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testCtx() Ctx {
	return Ctx{
		Parameters: map[string]any{
			"name":       "my service",
			"needsTopic": true,
			"replicas":   float64(3),
			"nested":     map[string]any{"deep": "value"},
			"list":       []any{"a", "b"},
			"emptyStr":   "",
			"emptyList":  []any{},
			"nilValue":   nil,
		},
		Steps: map[string]StepOutput{
			"repo": {Output: map[string]any{
				"repoUrl":  "https://github.com/acme/my-service",
				"repoName": "my-service",
				"private":  false,
				"count":    float64(2),
			}},
		},
		User:      map[string]any{"id": "u1", "email": "dev@example.com"},
		Workspace: map[string]any{"id": "w1", "slug": "acme"},
		Template:  map[string]any{"id": "t1", "version": float64(4)},
		RunID:     "run-123",
	}
}

func TestResolveString(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    any
		wantErr string
	}{
		// namespaces
		{name: "parameters", in: "${{ parameters.name }}", want: "my service"},
		{name: "parameters nested", in: "${{ parameters.nested.deep }}", want: "value"},
		{name: "steps output", in: "${{ steps.repo.output.repoUrl }}", want: "https://github.com/acme/my-service"},
		{name: "user", in: "${{ user.email }}", want: "dev@example.com"},
		{name: "workspace", in: "${{ workspace.slug }}", want: "acme"},
		{name: "template", in: "${{ template.id }}", want: "t1"},
		{name: "run id", in: "${{ run.id }}", want: "run-123"},

		// type preservation on whole-string match
		{name: "bool preserved", in: "${{ parameters.needsTopic }}", want: true},
		{name: "false bool preserved", in: "${{ steps.repo.output.private }}", want: false},
		{name: "number preserved", in: "${{ parameters.replicas }}", want: float64(3)},
		{name: "map preserved", in: "${{ parameters.nested }}", want: map[string]any{"deep": "value"}},
		{name: "slice preserved", in: "${{ parameters.list }}", want: []any{"a", "b"}},
		{name: "explicit null preserved", in: "${{ parameters.nilValue }}", want: nil},

		// partial match stringifies
		{name: "partial string", in: "svc-${{ parameters.name }}-x", want: "svc-my service-x"},
		{name: "partial bool", in: "topic=${{ parameters.needsTopic }}", want: "topic=true"},
		{name: "partial number", in: "n=${{ parameters.replicas }}", want: "n=3"},
		{name: "two expressions", in: "${{ workspace.slug }}/${{ steps.repo.output.repoName }}", want: "acme/my-service"},
		{name: "no expression", in: "plain text", want: "plain text"},
		{name: "empty string", in: "", want: ""},
		{name: "dollar brace not expression", in: "${notAnExpr}", want: "${notAnExpr}"},

		// filters
		{name: "lower", in: "${{ steps.repo.output.repoName | lower }}", want: "my-service"},
		{name: "upper", in: "${{ parameters.name | upper }}", want: "MY SERVICE"},
		{name: "kebabCase", in: "${{ parameters.name | kebabCase }}", want: "my-service"},
		{name: "pascalCase", in: "${{ parameters.name | pascalCase }}", want: "MyService"},
		{name: "snakeCase", in: "${{ parameters.name | snakeCase }}", want: "my_service"},
		{name: "json string", in: "${{ parameters.name | json }}", want: `"my service"`},
		{name: "json map deterministic", in: "${{ parameters.nested | json }}", want: `{"deep":"value"}`},
		{name: "chained filters", in: "${{ parameters.name | kebabCase | upper }}", want: "MY-SERVICE"},
		{name: "filter forces string type", in: "${{ parameters.needsTopic | upper }}", want: "TRUE"},

		// default()
		{name: "default masks missing path", in: `${{ parameters.absent | default("fallback") }}`, want: "fallback"},
		{name: "default masks missing step", in: `${{ steps.notrun.output.x | default("none") }}`, want: "none"},
		{name: "default ignored when present", in: `${{ parameters.name | default("fallback") }}`, want: "my service"},
		{name: "default masks empty string", in: `${{ parameters.emptyStr | default("fallback") }}`, want: "fallback"},
		{name: "default masks explicit nil", in: `${{ parameters.nilValue | default("fallback") }}`, want: "fallback"},
		{name: "default single quotes", in: "${{ parameters.absent | default('fb') }}", want: "fb"},
		{name: "default bool literal", in: "${{ parameters.absent | default(true) }}", want: true},
		{name: "default number literal", in: "${{ parameters.absent | default(7) }}", want: float64(7)},
		{name: "default then filter", in: `${{ parameters.absent | default("Ab Cd") | kebabCase }}`, want: "ab-cd"},

		// errors
		{name: "missing parameter", in: "${{ parameters.absent }}", wantErr: "parameters.absent"},
		{name: "missing step", in: "${{ steps.notrun.output.x }}", wantErr: "steps.notrun"},
		{name: "missing step output key", in: "${{ steps.repo.output.nope }}", wantErr: "steps.repo.output.nope"},
		{name: "steps without output segment", in: "${{ steps.repo.repoUrl }}", wantErr: "output"},
		{name: "unknown namespace", in: "${{ secrets.token }}", wantErr: "unknown namespace"},
		{name: "unknown filter", in: "${{ parameters.name | rot13 }}", wantErr: "unknown filter"},
		{name: "unterminated expression", in: "${{ parameters.name", wantErr: "unterminated"},
		{name: "empty expression", in: "${{ }}", wantErr: "empty expression"},
		{name: "traverse into scalar", in: "${{ parameters.name.oops }}", wantErr: "parameters.name.oops"},
		{name: "filter on missing without default", in: "${{ parameters.absent | upper }}", wantErr: "parameters.absent"},
		{name: "run unknown key", in: "${{ run.nope }}", wantErr: "run.nope"},
		{name: "partial stringify of null fails loudly", in: "x=${{ parameters.nilValue }}", wantErr: "stringify null"},
		{name: "filter on explicit null", in: "${{ parameters.nilValue | upper }}", wantErr: "which is null"},
		{name: "default NaN is not a float", in: "${{ parameters.absent | default(NaN) }}", want: "NaN"},
		{name: "default Inf is not a float", in: "${{ parameters.absent | default(Inf) }}", want: "Inf"},
		{name: "escaped quote in default", in: `${{ parameters.absent | default("a\"b") }}`, want: `a"b`},
	}

	ctx := testCtx()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resolve(ctx, tt.in)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestResolveWalksContainers(t *testing.T) {
	ctx := testCtx()
	in := map[string]any{
		"name": "${{ parameters.name | kebabCase }}",
		"flag": "${{ parameters.needsTopic }}",
		"nested": map[string]any{
			"list": []any{"${{ workspace.slug }}", "literal", float64(1), true, nil},
		},
		"untouched": float64(42),
	}
	got, err := Resolve(ctx, in)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"name": "my-service",
		"flag": true,
		"nested": map[string]any{
			"list": []any{"acme", "literal", float64(1), true, nil},
		},
		"untouched": float64(42),
	}, got)
}

func TestResolveContainerErrorNamesPath(t *testing.T) {
	ctx := testCtx()
	_, err := Resolve(ctx, map[string]any{"a": map[string]any{"b": "${{ parameters.absent }}"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "a.b")
}

func TestResolveIsDeterministicForMaps(t *testing.T) {
	ctx := testCtx()
	in := map[string]any{}
	for _, k := range []string{"z", "y", "x", "w", "v", "u"} {
		in[k] = "${{ parameters.absent }}"
	}
	first := ""
	for i := 0; i < 25; i++ {
		_, err := Resolve(ctx, in)
		require.Error(t, err)
		if first == "" {
			first = err.Error()
		}
		assert.Equal(t, first, err.Error(), "error must not depend on map iteration order")
	}
}

func TestResolveJSON(t *testing.T) {
	ctx := testCtx()
	out, err := ResolveJSON(ctx, json.RawMessage(`{"b":"${{ parameters.needsTopic }}","a":"${{ parameters.name | kebabCase }}"}`))
	require.NoError(t, err)
	assert.JSONEq(t, `{"a":"my-service","b":true}`, string(out))

	_, err = ResolveJSON(ctx, json.RawMessage(`{"a":"${{ parameters.absent }}"}`))
	require.Error(t, err)

	out, err = ResolveJSON(ctx, nil)
	require.NoError(t, err)
	assert.Nil(t, out)
}

func TestResolveDoesNotMutateInput(t *testing.T) {
	ctx := testCtx()
	in := map[string]any{"name": "${{ parameters.name }}"}
	_, err := Resolve(ctx, in)
	require.NoError(t, err)
	assert.Equal(t, "${{ parameters.name }}", in["name"])
}

func TestResolveNoNestedExpansion(t *testing.T) {
	// A resolved value that itself looks like an expression must not be re-resolved.
	ctx := testCtx()
	ctx.Parameters["evil"] = "${{ user.email }}"
	got, err := Resolve(ctx, "${{ parameters.evil }}")
	require.NoError(t, err)
	assert.Equal(t, "${{ user.email }}", got)
}

func TestEvalBool(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    bool
		wantErr string
	}{
		{name: "wrapped true", in: "${{ parameters.needsTopic }}", want: true},
		{name: "wrapped false", in: "${{ steps.repo.output.private }}", want: false},
		{name: "bare path", in: "parameters.needsTopic", want: true},
		{name: "non-empty string is true", in: "${{ parameters.name }}", want: true},
		{name: "empty string is false", in: "${{ parameters.emptyStr }}", want: false},
		{name: "nil is false", in: "${{ parameters.nilValue }}", want: false},
		{name: "zero number is false", in: `${{ parameters.absent | default(0) }}`, want: false},
		{name: "non-zero number is true", in: "${{ parameters.replicas }}", want: true},
		{name: "literal false string", in: `${{ parameters.absent | default("false") }}`, want: false},
		{name: "empty string default is false", in: `${{ parameters.absent | default("") }}`, want: false},
		{name: "empty slice is false", in: "${{ parameters.emptyList }}", want: false},
		{name: "slice is true", in: "${{ parameters.list }}", want: true},
		{name: "blank expression errors", in: "   ", wantErr: "empty"},
		{name: "missing path errors", in: "${{ parameters.absent }}", wantErr: "parameters.absent"},
		{name: "mixed literal text errors", in: "yes ${{ parameters.needsTopic }}", wantErr: "single expression"},
	}
	ctx := testCtx()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EvalBool(ctx, tt.in)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestExtractReferences(t *testing.T) {
	refs, err := ExtractReferences(`a ${{ parameters.name | upper }} b ${{ steps.repo.output.repoUrl }}`)
	require.NoError(t, err)
	require.Len(t, refs, 2)
	assert.Equal(t, []string{"parameters", "name"}, refs[0].Path)
	assert.Equal(t, []string{"steps", "repo", "output", "repoUrl"}, refs[1].Path)
	assert.False(t, refs[0].HasDefault)

	refs, err = ExtractReferences(`${{ parameters.a | default("x") }}`)
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.True(t, refs[0].HasDefault)

	assert.False(t, HasExpression("plain"))
	assert.True(t, HasExpression("a ${{ b.c }}"))
}

func TestCaseFilters(t *testing.T) {
	tests := []struct{ in, kebab, pascal, snake string }{
		{"my service", "my-service", "MyService", "my_service"},
		{"MyService", "my-service", "MyService", "my_service"},
		{"my_service_name", "my-service-name", "MyServiceName", "my_service_name"},
		{"my-service", "my-service", "MyService", "my_service"},
		{"HTTPServer", "http-server", "HttpServer", "http_server"},
		{"order2ship", "order2ship", "Order2ship", "order2ship"},
		{"  spaced  out  ", "spaced-out", "SpacedOut", "spaced_out"},
		{"a", "a", "A", "a"},
		{"", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			assert.Equal(t, tt.kebab, kebabCase(tt.in), "kebabCase")
			assert.Equal(t, tt.pascal, pascalCase(tt.in), "pascalCase")
			assert.Equal(t, tt.snake, snakeCase(tt.in), "snakeCase")
		})
	}
}

func TestResolveRejectsExpressionKeys(t *testing.T) {
	ctx := testCtx()
	_, err := Resolve(ctx, map[string]any{"${{ parameters.name }}": "v"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "object keys")

	_, err = Resolve(ctx, map[string]any{"outer": map[string]any{"${{ parameters.name }}": "v"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outer")
}

func TestNormalizeCondition(t *testing.T) {
	assert.Equal(t, "", NormalizeCondition("   "))
	assert.Equal(t, "${{ parameters.a }}", NormalizeCondition("parameters.a"))
	assert.Equal(t, "${{ parameters.a }}", NormalizeCondition("  ${{ parameters.a }}  "))
}

func TestResolveJSONRoundTripsNonFiniteDefaults(t *testing.T) {
	// A default() that parsed as NaN would fail at marshal time, far from the
	// expression that caused it.
	out, err := ResolveJSON(testCtx(), json.RawMessage(`{"a":"${{ parameters.absent | default(NaN) }}"}`))
	require.NoError(t, err)
	assert.JSONEq(t, `{"a":"NaN"}`, string(out))
}
