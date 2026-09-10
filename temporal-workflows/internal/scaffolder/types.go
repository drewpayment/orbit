// Package scaffolder implements Orbit's v2 template engine: the definition
// document schema, the `${{ }}` expression language, static validation, and the
// action registry that the generic ScaffolderWorkflow dispatches through.
//
// See docs/plans/2026-09-09-template-authoring-phase-1-engine.md §3-§5.
package scaffolder

import "encoding/json"

// APIVersionV2 and KindTemplate are the only accepted document identifiers.
const (
	APIVersionV2 = "orbit/v2"
	KindTemplate = "Template"
)

// Definition is a v2 template document. It is stored verbatim as
// `template-definition-versions.definitionJson` and passed to the workflow.
type Definition struct {
	APIVersion string   `json:"apiVersion"`
	Kind       string   `json:"kind"`
	Metadata   Metadata `json:"metadata"`
	Spec       Spec     `json:"spec"`
}

// Metadata identifies and describes the template.
type Metadata struct {
	Name        string   `json:"name"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Owner       string   `json:"owner"`
	TargetKind  string   `json:"targetKind,omitempty"`
}

// Spec holds the form, the ordered steps and the run output template.
type Spec struct {
	Parameters []ParameterPage `json:"parameters"`
	Steps      []Step          `json:"steps"`
	Output     *Output         `json:"output,omitempty"`
}

// ParameterPage is one page of the run form, expressed as a JSON Schema object.
// Property values keep their raw JSON so `ui:` keys survive a round trip.
type ParameterPage struct {
	Title      string                     `json:"title"`
	Required   []string                   `json:"required,omitempty"`
	Properties map[string]json.RawMessage `json:"properties"`
}

// Step is a single action invocation. Input stays raw: each action unmarshals it
// into its own typed struct after expression resolution.
type Step struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Action          string          `json:"action"`
	Input           json.RawMessage `json:"input"`
	If              string          `json:"if,omitempty"`
	ContinueOnError bool            `json:"continueOnError,omitempty"`
	Timeout         string          `json:"timeout,omitempty"`
}

// Output is the run result template, resolved against the final expression Ctx.
type Output struct {
	Links []OutputLink `json:"links,omitempty"`
	Text  string       `json:"text,omitempty"`
}

// OutputLink is one link on the run result page. Exactly one of URL or Entity
// is expected; Entity renders as an in-app catalog link.
type OutputLink struct {
	Title  string `json:"title"`
	URL    string `json:"url,omitempty"`
	Entity string `json:"entity,omitempty"`
}
