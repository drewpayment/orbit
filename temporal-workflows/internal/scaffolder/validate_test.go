package scaffolder

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type schemaAction struct {
	name string
	in   string
	out  string
}

func (s *schemaAction) Name() string                 { return s.name }
func (s *schemaAction) InputSchema() json.RawMessage  { return json.RawMessage(s.in) }
func (s *schemaAction) OutputSchema() json.RawMessage { return json.RawMessage(s.out) }
func (s *schemaAction) Execute(context.Context, ActionRunContext, json.RawMessage) (json.RawMessage, error) {
	return nil, nil
}
func (s *schemaAction) Plan(context.Context, ActionRunContext, json.RawMessage) ([]PlannedChange, error) {
	return nil, ErrNoPlan
}

func testRegistry() *Registry {
	return NewRegistry(
		&schemaAction{
			name: "github:repo:create",
			in: `{"type":"object","properties":{"name":{"type":"string"},"private":{"type":"boolean"},"replicas":{"type":"integer"}},"required":["name"],"additionalProperties":false}`,
			out: `{"type":"object","properties":{"repoUrl":{"type":"string"},"repoName":{"type":"string"},"checkout":{"type":"string"}}}`,
		},
		&schemaAction{
			name: "debug:log",
			in:   `{"type":"object","properties":{"message":{"type":"string"}},"required":["message"]}`,
			out:  `{"type":"object","properties":{"message":{"type":"string"}}}`,
		},
		&schemaAction{
			name: "nested:thing",
			in:   `{"type":"object","properties":{"cfg":{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"string"}},"required":["a","b"]}},"required":["cfg"]}`,
			out:  `{"type":"object","properties":{"ok":{"type":"boolean"}}}`,
		},
	)
}

func validDefinition() *Definition {
	return &Definition{
		APIVersion: APIVersionV2,
		Kind:       KindTemplate,
		Metadata:   Metadata{Name: "backend-service", Title: "New Backend Service", Owner: "team:platform"},
		Spec: Spec{
			Parameters: []ParameterPage{{
				Title:      "Service",
				Required:   []string{"name"},
				Properties: map[string]json.RawMessage{"name": json.RawMessage(`{"type":"string"}`), "private": json.RawMessage(`{"type":"boolean"}`)},
			}},
			Steps: []Step{
				{ID: "repo", Name: "Create repo", Action: "github:repo:create",
					Input: json.RawMessage(`{"name":"${{ parameters.name | kebabCase }}","private":"${{ parameters.private }}"}`)},
				{ID: "log", Name: "Log", Action: "debug:log",
					If:    "${{ parameters.private }}",
					Input: json.RawMessage(`{"message":"created ${{ steps.repo.output.repoUrl }} for ${{ user.email }} in ${{ workspace.slug }} run ${{ run.id }} tmpl ${{ template.id }}"}`)},
			},
			Output: &Output{
				Links: []OutputLink{{Title: "Repository", URL: "${{ steps.repo.output.repoUrl }}"}},
				Text:  "done: ${{ steps.log.output.message }}",
			},
		},
	}
}

func messages(errs []ValidationError) string {
	var b strings.Builder
	for _, e := range errs {
		b.WriteString(e.Error())
		b.WriteString("\n")
	}
	return b.String()
}

func TestValidateAcceptsValidDefinition(t *testing.T) {
	errs := Validate(validDefinition(), testRegistry())
	assert.Empty(t, errs, messages(errs))
}

func TestValidateDocumentHeader(t *testing.T) {
	def := validDefinition()
	def.APIVersion = "orbit/v1"
	def.Kind = "Thing"
	def.Metadata.Name = "Bad Name"
	def.Metadata.Title = ""
	def.Metadata.Owner = ""
	errs := Validate(def, testRegistry())
	msg := messages(errs)
	assert.Contains(t, msg, "apiVersion")
	assert.Contains(t, msg, "kind")
	assert.Contains(t, msg, "metadata.name")
	assert.Contains(t, msg, "metadata.title")
	assert.Contains(t, msg, "metadata.owner")
}

func TestValidateStepIdentity(t *testing.T) {
	tests := []struct {
		name  string
		mutate func(*Definition)
		want  string
	}{
		{"duplicate ids", func(d *Definition) { d.Spec.Steps[1].ID = "repo" }, "duplicate step id"},
		{"empty id", func(d *Definition) { d.Spec.Steps[0].ID = "" }, "step id"},
		{"bad id charset", func(d *Definition) { d.Spec.Steps[0].ID = "Repo_1" }, "step id"},
		{"empty action", func(d *Definition) { d.Spec.Steps[0].Action = "" }, "action is required"},
		{"unknown action", func(d *Definition) { d.Spec.Steps[0].Action = "nope:missing" }, "unknown action"},
		{"no steps", func(d *Definition) { d.Spec.Steps = nil }, "at least one step"},
		{"bad timeout", func(d *Definition) { d.Spec.Steps[0].Timeout = "5 fortnights" }, "timeout"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := validDefinition()
			tt.mutate(def)
			errs := Validate(def, testRegistry())
			assert.Contains(t, messages(errs), tt.want)
		})
	}
}

func TestValidateGoodTimeouts(t *testing.T) {
	def := validDefinition()
	def.Spec.Steps[0].Timeout = "5m"
	assert.Empty(t, Validate(def, testRegistry()))
}

func TestValidateExpressionReferences(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Definition)
		want   string
	}{
		{
			name:   "forward step reference",
			mutate: func(d *Definition) { d.Spec.Steps[0].Input = json.RawMessage(`{"name":"${{ steps.log.output.message }}"}`) },
			want:   "later step",
		},
		{
			name:   "self reference",
			mutate: func(d *Definition) { d.Spec.Steps[0].Input = json.RawMessage(`{"name":"${{ steps.repo.output.repoUrl }}"}`) },
			want:   "itself",
		},
		{
			name:   "unknown step",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.ghost.output.x }}"}`) },
			want:   "unknown step",
		},
		{
			name:   "unknown output key",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.repo.output.nope }}"}`) },
			want:   "does not declare output",
		},
		{
			name:   "steps ref missing output segment",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.repo.repoUrl }}"}`) },
			want:   "output",
		},
		{
			name:   "unknown parameter",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.ghost }}"}`) },
			want:   "no parameter named",
		},
		{
			name:   "unknown namespace",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ secrets.token }}"}`) },
			want:   "unknown namespace",
		},
		{
			name:   "bad expression syntax",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.name "}`) },
			want:   "unterminated",
		},
		{
			name:   "unknown filter",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.name | rot13 }}"}`) },
			want:   "unknown filter",
		},
		{
			name:   "run namespace beyond id",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ run.startedAt }}"}`) },
			want:   "run.id",
		},
		{
			name:   "whole step output object is allowed",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.repo.output | json }}"}`) },
			want:   "",
		},
		{
			name:   "bad reference in if",
			mutate: func(d *Definition) { d.Spec.Steps[1].If = "${{ parameters.ghost }}" },
			want:   "no parameter named",
		},
		{
			name:   "if referencing a later step",
			mutate: func(d *Definition) { d.Spec.Steps[0].If = "${{ steps.log.output.message }}" },
			want:   "later step",
		},
		{
			name:   "bad reference in output link",
			mutate: func(d *Definition) { d.Spec.Output.Links[0].URL = "${{ steps.ghost.output.x }}" },
			want:   "unknown step",
		},
		{
			name:   "bad reference in output text",
			mutate: func(d *Definition) { d.Spec.Output.Text = "${{ parameters.ghost }}" },
			want:   "no parameter named",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := validDefinition()
			tt.mutate(def)
			errs := Validate(def, testRegistry())
			if tt.want == "" {
				assert.Empty(t, errs, messages(errs))
				return
			}
			require.NotEmpty(t, errs)
			assert.Contains(t, messages(errs), tt.want)
		})
	}
}

func TestValidateOutputSectionMayReferenceAnyStep(t *testing.T) {
	def := validDefinition()
	def.Spec.Output.Text = "${{ steps.log.output.message }}"
	assert.Empty(t, Validate(def, testRegistry()))
}

func TestValidateLiteralInputAgainstSchema(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string // "" means valid
	}{
		{name: "valid literals", input: `{"name":"svc","private":true}`},
		{name: "wrong type", input: `{"name":123}`, want: "name"},
		{name: "missing required literal", input: `{"private":true}`, want: "name"},
		{name: "additional property", input: `{"name":"svc","bogus":1}`, want: "bogus"},
		{name: "required satisfied by expression", input: `{"name":"${{ parameters.name }}"}`},
		{name: "expression in typed field is skipped", input: `{"name":"svc","private":"${{ parameters.private }}"}`},
		{name: "expression cannot excuse a sibling", input: `{"name":"${{ parameters.name }}","private":7}`, want: "private"},
		{name: "null input treated as empty", input: `null`, want: "name"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := validDefinition()
			def.Spec.Steps = def.Spec.Steps[:1]
			def.Spec.Output = nil
			def.Spec.Steps[0].Input = json.RawMessage(tt.input)
			errs := Validate(def, testRegistry())
			if tt.want == "" {
				assert.Empty(t, errs, messages(errs))
				return
			}
			assert.Contains(t, messages(errs), tt.want)
		})
	}
}

func TestValidateNestedExpressionRelaxesNestedRequired(t *testing.T) {
	def := validDefinition()
	def.Spec.Output = nil
	def.Spec.Steps = []Step{{
		ID: "n", Name: "n", Action: "nested:thing",
		Input: json.RawMessage(`{"cfg":{"a":"${{ parameters.name }}","b":"literal"}}`),
	}}
	errs := Validate(def, testRegistry())
	assert.Empty(t, errs, messages(errs))

	def.Spec.Steps[0].Input = json.RawMessage(`{"cfg":{"a":"${{ parameters.name }}","b":42}}`)
	assert.NotEmpty(t, Validate(def, testRegistry()))
}

func TestValidateMalformedInputJSON(t *testing.T) {
	def := validDefinition()
	def.Spec.Steps[0].Input = json.RawMessage(`{"name":`)
	assert.Contains(t, messages(Validate(def, testRegistry())), "input")
}

func TestValidateParameterPages(t *testing.T) {
	def := validDefinition()
	def.Spec.Parameters[0].Required = []string{"name", "ghost"}
	assert.Contains(t, messages(Validate(def, testRegistry())), "ghost")

	def = validDefinition()
	def.Spec.Parameters = append(def.Spec.Parameters, ParameterPage{
		Title:      "Dupes",
		Properties: map[string]json.RawMessage{"name": json.RawMessage(`{"type":"string"}`)},
	})
	assert.Contains(t, messages(Validate(def, testRegistry())), "declared on more than one page")

	def = validDefinition()
	def.Spec.Parameters[0].Properties["bad"] = json.RawMessage(`{"type":`)
	assert.Contains(t, messages(Validate(def, testRegistry())), "bad")
}

func TestValidateCollectsAllErrors(t *testing.T) {
	def := validDefinition()
	def.APIVersion = "wrong"
	def.Spec.Steps[1].ID = "repo"
	def.Spec.Steps[1].Action = "nope:missing"
	errs := Validate(def, testRegistry())
	assert.GreaterOrEqual(t, len(errs), 3, messages(errs))
}

func TestValidateIsDeterministic(t *testing.T) {
	def := validDefinition()
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.z1 }}${{ parameters.z2 }}${{ parameters.z3 }}${{ parameters.z4 }}${{ parameters.z5 }}"}`)
	first := messages(Validate(def, testRegistry()))
	for i := 0; i < 25; i++ {
		assert.Equal(t, first, messages(Validate(def, testRegistry())))
	}
}

func TestValidateNilInputs(t *testing.T) {
	assert.NotEmpty(t, Validate(nil, testRegistry()))
	assert.NotEmpty(t, Validate(validDefinition(), nil))
}
