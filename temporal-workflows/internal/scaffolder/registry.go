package scaffolder

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

// ActionDescriptor is the serialisable view of a registered action. It is
// exposed over gRPC (`ListActions`) so orbit-www can run the TypeScript
// validator against the live registry (plan §5.2).
type ActionDescriptor struct {
	Name         string          `json:"name"`
	Family       string          `json:"family"`
	InputSchema  json.RawMessage `json:"inputSchema"`
	OutputSchema json.RawMessage `json:"outputSchema"`
	SupportsPlan bool            `json:"supportsPlan"`
}

// Registry maps action names to implementations. It is built once at worker
// startup and is read-only thereafter, so it is safe for concurrent use.
type Registry struct {
	actions map[string]Action
	names   []string // sorted
}

// NewRegistry builds a registry from a static action list. It panics on a
// duplicate or empty action name: the registry is assembled from a compile-time
// list at startup, so either is a programming error, not a runtime condition.
func NewRegistry(actions ...Action) *Registry {
	r := &Registry{actions: make(map[string]Action, len(actions))}
	for _, a := range actions {
		if a == nil {
			panic("scaffolder: nil action registered")
		}
		name := a.Name()
		if strings.TrimSpace(name) == "" {
			panic("scaffolder: action registered with an empty name")
		}
		if _, dup := r.actions[name]; dup {
			panic(fmt.Sprintf("scaffolder: duplicate action %q registered", name))
		}
		r.actions[name] = a
		r.names = append(r.names, name)
	}
	sort.Strings(r.names)
	return r
}

// ValidateSchemas checks that every registered action's schemas are parsable
// JSON Schema documents. Call it once at worker startup: a broken action schema
// is a platform bug, and without this it would surface later as a validation
// finding against whichever template happened to use the action.
func (r *Registry) ValidateSchemas() error {
	if r == nil {
		return nil
	}
	for _, n := range r.names {
		a := r.actions[n]
		for label, raw := range map[string]json.RawMessage{"input": a.InputSchema(), "output": a.OutputSchema()} {
			if len(raw) == 0 {
				return fmt.Errorf("action %q has an empty %s schema", n, label)
			}
			compiler := jsonschema.NewCompiler()
			url := "mem://orbit/scaffolder/" + n + "/" + label + ".json"
			if err := compiler.AddResource(url, bytes.NewReader(raw)); err != nil {
				return fmt.Errorf("action %q has an invalid %s schema: %w", n, label, err)
			}
			if _, err := compiler.Compile(url); err != nil {
				return fmt.Errorf("action %q has an invalid %s schema: %w", n, label, err)
			}
		}
	}
	return nil
}

// Get returns the action registered under name.
func (r *Registry) Get(name string) (Action, bool) {
	if r == nil {
		return nil, false
	}
	a, ok := r.actions[name]
	return a, ok
}

// Names returns every registered action name, sorted.
func (r *Registry) Names() []string {
	if r == nil {
		return nil
	}
	out := make([]string, len(r.names))
	copy(out, r.names)
	return out
}

// Descriptor returns the descriptor for a single action.
func (r *Registry) Descriptor(name string) (ActionDescriptor, bool) {
	a, ok := r.Get(name)
	if !ok {
		return ActionDescriptor{}, false
	}
	return describe(a), true
}

// Descriptors returns every descriptor, sorted by name. The returned slice and
// its schema bytes are copies, so callers cannot mutate registry state.
func (r *Registry) Descriptors() []ActionDescriptor {
	if r == nil {
		return nil
	}
	out := make([]ActionDescriptor, 0, len(r.names))
	for _, n := range r.names {
		out = append(out, describe(r.actions[n]))
	}
	return out
}

// OutputKeys returns the `properties` keys of an action's OutputSchema — the
// exact set that `${{ steps.<id>.output.<key> }}` may reference.
func (r *Registry) OutputKeys(name string) ([]string, error) {
	a, ok := r.Get(name)
	if !ok {
		return nil, fmt.Errorf("unknown action %q", name)
	}
	return schemaPropertyNames(a.OutputSchema())
}

// InputSchemaOf returns an action's input schema.
func (r *Registry) InputSchemaOf(name string) (json.RawMessage, error) {
	a, ok := r.Get(name)
	if !ok {
		return nil, fmt.Errorf("unknown action %q", name)
	}
	return cloneRaw(a.InputSchema()), nil
}

func describe(a Action) ActionDescriptor {
	d := ActionDescriptor{
		Name:         a.Name(),
		Family:       familyFromName(a.Name()),
		InputSchema:  cloneRaw(a.InputSchema()),
		OutputSchema: cloneRaw(a.OutputSchema()),
		SupportsPlan: true,
	}
	if f, ok := a.(FamilyDeclarer); ok {
		d.Family = f.Family()
	}
	if p, ok := a.(PlanDeclarer); ok {
		d.SupportsPlan = p.SupportsPlan()
	}
	return d
}

// familyFromName takes the segment before the first ":" — "github:repo:create"
// belongs to the "github" family.
func familyFromName(name string) string {
	if i := strings.IndexByte(name, ':'); i >= 0 {
		return name[:i]
	}
	return name
}

func cloneRaw(in json.RawMessage) json.RawMessage {
	if in == nil {
		return nil
	}
	out := make(json.RawMessage, len(in))
	copy(out, in)
	return out
}

// schemaPropertyNames pulls the top-level `properties` keys out of a JSON
// Schema document. A schema without `properties` yields no keys.
func schemaPropertyNames(schema json.RawMessage) ([]string, error) {
	if len(schema) == 0 {
		return nil, nil
	}
	var doc struct {
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(schema, &doc); err != nil {
		return nil, fmt.Errorf("parse schema: %w", err)
	}
	out := make([]string, 0, len(doc.Properties))
	for k := range doc.Properties {
		out = append(out, k)
	}
	sort.Strings(out)
	return out, nil
}

// ExportDescriptorsJSON renders a registry built from actions as the stable,
// indented JSON document the repository service embeds to serve ListActions.
//
// It validates the schemas first: exporting a broken schema would ship the bug
// to every consumer of the descriptor file.
func ExportDescriptorsJSON(actions []Action) ([]byte, error) {
	r := NewRegistry(actions...)
	if err := r.ValidateSchemas(); err != nil {
		return nil, err
	}
	// Descriptors() is already sorted by name, and the schema bytes come
	// straight from each action's embedded file, so the output is stable for a
	// given set of actions.
	return json.MarshalIndent(r.Descriptors(), "", "  ")
}
