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

func (s *schemaAction) Name() string                  { return s.name }
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
			in:   `{"type":"object","properties":{"name":{"type":"string"},"private":{"type":"boolean"},"replicas":{"type":"integer"}},"required":["name"],"additionalProperties":false}`,
			out:  `{"type":"object","properties":{"repoUrl":{"type":"string"},"repoName":{"type":"string"},"checkout":{"type":"string"}}}`,
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
		&schemaAction{
			// Mirrors fs:render's input schema: `values` validates its
			// entries via a schema-valued `additionalProperties` rather than
			// a declared `properties` map, since its keys are template
			// authors' own variable names.
			name: "fs:render",
			in:   `{"type":"object","properties":{"path":{"type":"string","minLength":1},"values":{"type":"object","additionalProperties":{"type":"string"}}},"required":["path","values"],"additionalProperties":false}`,
			out:  `{"type":"object","properties":{"path":{"type":"string"}}}`,
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
		name   string
		mutate func(*Definition)
		want   string
	}{
		{"duplicate ids", func(d *Definition) { d.Spec.Steps[1].ID = "repo" }, "duplicate step id"},
		{"empty id", func(d *Definition) { d.Spec.Steps[0].ID = "" }, "step id"},
		{"bad id charset", func(d *Definition) { d.Spec.Steps[0].ID = "Repo_1" }, "step id"},
		{"empty action", func(d *Definition) { d.Spec.Steps[0].Action = "" }, "action is required"},
		{"unknown action", func(d *Definition) { d.Spec.Steps[0].Action = "nope:missing" }, "unknown action"},
		{"no steps", func(d *Definition) { d.Spec.Steps = nil }, "at least one step"},
		{"bad timeout", func(d *Definition) { d.Spec.Steps[0].Timeout = "5 fortnights" }, "timeout"},
		{"expression in step name", func(d *Definition) { d.Spec.Steps[0].Name = "build ${{ parameters.name }}" }, "step name"},
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
			name: "forward step reference",
			mutate: func(d *Definition) {
				d.Spec.Steps[0].Input = json.RawMessage(`{"name":"${{ steps.log.output.message }}"}`)
			},
			want: "later step",
		},
		{
			name: "self reference",
			mutate: func(d *Definition) {
				d.Spec.Steps[0].Input = json.RawMessage(`{"name":"${{ steps.repo.output.repoUrl }}"}`)
			},
			want: "itself",
		},
		{
			name: "unknown step",
			mutate: func(d *Definition) {
				d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.ghost.output.x }}"}`)
			},
			want: "unknown step",
		},
		{
			name: "unknown output key",
			mutate: func(d *Definition) {
				d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.repo.output.nope }}"}`)
			},
			want: "does not declare output",
		},
		{
			name: "steps ref missing output segment",
			mutate: func(d *Definition) {
				d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.repo.repoUrl }}"}`)
			},
			want: "output",
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
			name: "unknown filter",
			mutate: func(d *Definition) {
				d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.name | rot13 }}"}`)
			},
			want: "unknown filter",
		},
		{
			name:   "run namespace beyond id",
			mutate: func(d *Definition) { d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ run.startedAt }}"}`) },
			want:   "run.id",
		},
		{
			name: "whole step output object is allowed",
			mutate: func(d *Definition) {
				d.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.repo.output | json }}"}`)
			},
			want: "",
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
		{name: "additional property hidden behind an expression", input: `{"name":"svc","bogus":"${{ parameters.name }}"}`, want: "bogus"},
		{name: "additional property hidden in an expression array", input: `{"name":"svc","bogus":["${{ parameters.name }}"]}`, want: "bogus"},
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

// TestValidateNestedExpressionUnderAdditionalProperties reproduces a live
// dry-run bug: an expression nested inside an object whose schema validates
// entries via a schema-valued `additionalProperties` (fs:render's `values`,
// e.g. `values.serviceName`) was never relaxed, because relaxSchema/
// relaxProperty only knew how to reach a key declared under `properties`. The
// stripped-to-null leaf was then checked against `additionalProperties`'s
// `{"type":"string"}` and failed as "expected string, but got null", even
// though the identical expression at a top-level field (declared under
// `properties`) resolved and validated fine.
func TestValidateNestedExpressionUnderAdditionalProperties(t *testing.T) {
	def := validDefinition()
	def.Spec.Output = nil
	def.Spec.Steps = []Step{{
		ID: "render", Name: "render", Action: "fs:render",
		Input: json.RawMessage(`{"path":"repo","values":{"serviceName":"${{ parameters.name }}"}}`),
	}}
	errs := Validate(def, testRegistry())
	assert.Empty(t, errs, messages(errs))

	// A literal sibling in the same map must still be type-checked: relaxing
	// the whole `additionalProperties` schema for one expression key must not
	// silently accept a genuinely wrong-typed literal on another key.
	def.Spec.Steps[0].Input = json.RawMessage(`{"path":"lit","values":{"serviceName":"${{ parameters.name }}","other":42}}`)
	assert.NotEmpty(t, Validate(def, testRegistry()))
}

func TestValidateBarePathCondition(t *testing.T) {
	// EvalBool accepts a bare dotted path, so the validator must check it too;
	// otherwise the publish gate misses a reference the run will die on.
	def := validDefinition()
	def.Spec.Steps[0].If = "steps.log.output.message"
	assert.Contains(t, messages(Validate(def, testRegistry())), "later step")

	def = validDefinition()
	def.Spec.Steps[1].If = "secrets.token"
	assert.Contains(t, messages(Validate(def, testRegistry())), "unknown namespace")

	def = validDefinition()
	def.Spec.Steps[1].If = "parameters.private"
	assert.Empty(t, Validate(def, testRegistry()))
}

func TestValidateRejectsExpressionKeys(t *testing.T) {
	def := validDefinition()
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"hi","${{ parameters.name }}":"x"}`)
	assert.Contains(t, messages(Validate(def, testRegistry())), "object keys")
}

func TestValidateCombinatorRequiredWithExpression(t *testing.T) {
	// A stripped property must not trip a `required` inside a combinator: the
	// template is valid and has to be publishable.
	reg := NewRegistry(&schemaAction{
		name: "combo:thing",
		in:   `{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"string"}},"anyOf":[{"required":["a"]},{"required":["b"]}]}`,
		out:  `{"type":"object","properties":{"ok":{"type":"boolean"}}}`,
	})
	def := validDefinition()
	def.Spec.Output = nil
	def.Spec.Steps = []Step{{ID: "c", Name: "c", Action: "combo:thing", Input: json.RawMessage(`{"a":"${{ parameters.name }}"}`)}}
	assert.Empty(t, Validate(def, reg), messages(Validate(def, reg)))
}

func TestValidateOutputLinkShape(t *testing.T) {
	def := validDefinition()
	def.Spec.Output.Links[0].Entity = "${{ steps.repo.output.repoName }}"
	assert.Contains(t, messages(Validate(def, testRegistry())), "not both")

	def = validDefinition()
	def.Spec.Output.Links[0].URL = ""
	assert.Contains(t, messages(Validate(def, testRegistry())), "exactly one of")

	def = validDefinition()
	def.Spec.Output.Links[0].Title = ""
	assert.Contains(t, messages(Validate(def, testRegistry())), "spec.output.links[0].title")
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

func TestValidateParameterUIExpressions(t *testing.T) {
	def := validDefinition()
	def.Spec.Parameters[0].Properties["topicName"] = json.RawMessage(`{"type":"string","ui:visibleIf":"${{ parameters.private }}"}`)
	assert.Empty(t, Validate(def, testRegistry()), messages(Validate(def, testRegistry())))

	def = validDefinition()
	def.Spec.Parameters[0].Properties["topicName"] = json.RawMessage(`{"type":"string","ui:visibleIf":"${{ parameters.ghost }}"}`)
	assert.Contains(t, messages(Validate(def, testRegistry())), "no parameter named")

	// The form renders before any step runs, so a step reference is never valid
	// there — it must not silently resolve to an empty value at run time.
	def = validDefinition()
	def.Spec.Parameters[0].Properties["topicName"] = json.RawMessage(`{"type":"string","ui:visibleIf":"${{ steps.repo.output.repoUrl }}"}`)
	assert.Contains(t, messages(Validate(def, testRegistry())), "unknown step")
}

// --- review round 2 -------------------------------------------------------

func arrayRegistry() *Registry {
	return NewRegistry(&schemaAction{
		name: "array:thing",
		in:   `{"type":"object","properties":{"items":{"type":"array","items":{"type":"object","properties":{"count":{"type":"number"},"label":{"type":"string"}},"required":["count"]}},"tags":{"type":"array","items":{"type":"string"}}},"required":["items"]}`,
		out:  `{"type":"object","properties":{"ok":{"type":"boolean"}}}`,
	})
}

func arrayStep(input string) *Definition {
	def := validDefinition()
	def.Spec.Output = nil
	def.Spec.Steps = []Step{{ID: "a", Name: "a", Action: "array:thing", Input: json.RawMessage(input)}}
	return def
}

func TestValidateExpressionInsideObjectInsideArray(t *testing.T) {
	reg := arrayRegistry()

	// The probe from review: an expression nested in an object inside an array
	// must not be type-checked as the literal string it is written as.
	def := arrayStep(`{"items":[{"count":"${{ parameters.name }}"}]}`)
	assert.Empty(t, Validate(def, reg), messages(Validate(def, reg)))

	// Siblings and later elements are still checked.
	def = arrayStep(`{"items":[{"count":"${{ parameters.name }}","label":7}]}`)
	assert.Contains(t, messages(Validate(def, reg)), "label")

	def = arrayStep(`{"items":[{"count":"${{ parameters.name }}"},{"count":"literal"}]}`)
	assert.NotEmpty(t, Validate(def, reg), "a literal string in a number field must still fail")

	// A whole element that is an expression.
	def = arrayStep(`{"items":["${{ parameters.name }}"]}`)
	assert.Empty(t, Validate(def, reg), messages(Validate(def, reg)))

	// References inside arrays are still resolved against the reference graph.
	def = arrayStep(`{"items":[{"count":"${{ parameters.ghost }}"}]}`)
	assert.Contains(t, messages(Validate(def, reg)), "no parameter named")

	// A scalar array of expressions.
	def = arrayStep(`{"items":[],"tags":["${{ parameters.name }}","literal"]}`)
	assert.Empty(t, Validate(def, reg), messages(Validate(def, reg)))
}

func TestValidateConditionMustBeASingleExpression(t *testing.T) {
	// EvalBool requires exactly one expression covering the whole string, so
	// the validator has to enforce the same rule or the run dies on it.
	def := validDefinition()
	def.Spec.Steps[1].If = "${{ parameters.private }} and more"
	assert.Contains(t, messages(Validate(def, testRegistry())), "single expression")

	def = validDefinition()
	def.Spec.Steps[1].If = "${{ parameters.private }}${{ parameters.name }}"
	assert.Contains(t, messages(Validate(def, testRegistry())), "single expression")

	def = validDefinition()
	def.Spec.Steps[1].If = "  ${{ parameters.private }}  "
	assert.Empty(t, Validate(def, testRegistry()))
}

func TestValidateDefaultMustBeTheFirstFilter(t *testing.T) {
	def := validDefinition()
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.name | upper | default('x') }}"}`)
	assert.Contains(t, messages(Validate(def, testRegistry())), "default(")

	def = validDefinition()
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.name | default('x') | upper }}"}`)
	assert.Empty(t, Validate(def, testRegistry()), messages(Validate(def, testRegistry())))
}

func TestValidateDashedStepIDReference(t *testing.T) {
	def := validDefinition()
	def.Spec.Steps[0].ID = "my-step"
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ steps.my-step.output.repoUrl }}"}`)
	def.Spec.Output = nil
	assert.Empty(t, Validate(def, testRegistry()), messages(Validate(def, testRegistry())))
}
