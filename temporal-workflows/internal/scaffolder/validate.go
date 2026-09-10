package scaffolder

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

// ValidationError is one static-validation finding. Path is a dotted location
// inside the definition document, e.g. `spec.steps[1].input.message`.
type ValidationError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string { return e.Path + ": " + e.Message }

// ActionCatalog is the slice of the registry the validator needs. *Registry
// implements it; tests and the gRPC path can supply descriptors directly.
type ActionCatalog interface {
	Descriptor(name string) (ActionDescriptor, bool)
}

// DescriptorCatalog adapts a descriptor slice (e.g. one received over gRPC) to
// ActionCatalog.
type DescriptorCatalog []ActionDescriptor

// Descriptor implements ActionCatalog.
func (d DescriptorCatalog) Descriptor(name string) (ActionDescriptor, bool) {
	for _, x := range d {
		if x.Name == name {
			return x, true
		}
	}
	return ActionDescriptor{}, false
}

// MaxStepTimeout caps a step's declared `timeout`. Without a ceiling, a
// definition could pin a worker slot for the whole of the workflow's run
// timeout. Both static validation and the workflow's own parse enforce it, so
// a definition cannot slip past by being validated under an older build.
const MaxStepTimeout = 2 * time.Hour

var (
	nameRe   = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	stepIDRe = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
)

// Validate statically checks a definition against the action registry and
// returns every problem it finds, in a deterministic order. It performs no I/O
// and mutates nothing.
//
// The Go port exists as belt-and-suspenders for force-written or migrated
// definitions: the authoring UI runs the TypeScript twin before saving, and the
// workflow runs this one before executing (plan §3.2).
func Validate(def *Definition, actions ActionCatalog) []ValidationError {
	errs := []ValidationError{}
	if def == nil {
		return append(errs, ValidationError{Path: "", Message: "definition is nil"})
	}
	if actions == nil {
		return append(errs, ValidationError{Path: "", Message: "action catalog is nil"})
	}

	errs = append(errs, validateHeader(def)...)
	params, paramErrs := validateParameters(def.Spec.Parameters)
	errs = append(errs, paramErrs...)
	errs = append(errs, validateParameterExpressions(def.Spec.Parameters, params)...)

	if len(def.Spec.Steps) == 0 {
		errs = append(errs, ValidationError{Path: "spec.steps", Message: "a template must declare at least one step"})
	}

	// Step index by id, plus the first declaration position of each id, so
	// reference checks can tell "earlier" from "later" and "itself".
	stepIndex := make(map[string]int, len(def.Spec.Steps))
	seen := make(map[string]bool, len(def.Spec.Steps))
	for i, step := range def.Spec.Steps {
		if step.ID != "" && !seen[step.ID] {
			seen[step.ID] = true
			stepIndex[step.ID] = i
		}
	}

	for i, step := range def.Spec.Steps {
		errs = append(errs, validateStep(def, i, step, params, stepIndex, actions)...)
	}

	errs = append(errs, validateOutput(def, def.Spec.Output, params, stepIndex, len(def.Spec.Steps), actions)...)
	return errs
}

func validateHeader(def *Definition) []ValidationError {
	var errs []ValidationError
	if def.APIVersion != APIVersionV2 {
		errs = append(errs, ValidationError{Path: "apiVersion", Message: fmt.Sprintf("must be %q, got %q", APIVersionV2, def.APIVersion)})
	}
	if def.Kind != KindTemplate {
		errs = append(errs, ValidationError{Path: "kind", Message: fmt.Sprintf("must be %q, got %q", KindTemplate, def.Kind)})
	}
	if !nameRe.MatchString(def.Metadata.Name) {
		errs = append(errs, ValidationError{Path: "metadata.name", Message: fmt.Sprintf("must match %s, got %q", nameRe, def.Metadata.Name)})
	}
	if strings.TrimSpace(def.Metadata.Title) == "" {
		errs = append(errs, ValidationError{Path: "metadata.title", Message: "is required"})
	}
	if strings.TrimSpace(def.Metadata.Owner) == "" {
		errs = append(errs, ValidationError{Path: "metadata.owner", Message: "is required"})
	}
	return errs
}

// validateParameters returns the set of declared parameter names.
func validateParameters(pages []ParameterPage) (map[string]bool, []ValidationError) {
	params := map[string]bool{}
	var errs []ValidationError
	declaredOn := map[string]int{}

	for i, page := range pages {
		base := fmt.Sprintf("spec.parameters[%d]", i)
		if strings.TrimSpace(page.Title) == "" {
			errs = append(errs, ValidationError{Path: base + ".title", Message: "is required"})
		}
		names := make([]string, 0, len(page.Properties))
		for n := range page.Properties {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			var probe any
			if err := json.Unmarshal(page.Properties[n], &probe); err != nil {
				errs = append(errs, ValidationError{Path: base + ".properties." + n, Message: fmt.Sprintf("is not valid JSON: %v", err)})
				continue
			}
			if prev, dup := declaredOn[n]; dup {
				errs = append(errs, ValidationError{
					Path:    base + ".properties." + n,
					Message: fmt.Sprintf("parameter %q is declared on more than one page (also page %d)", n, prev),
				})
				continue
			}
			declaredOn[n] = i
			params[n] = true
		}
		for _, req := range page.Required {
			if _, ok := page.Properties[req]; !ok {
				errs = append(errs, ValidationError{Path: base + ".required", Message: fmt.Sprintf("requires %q, which is not declared on this page", req)})
			}
		}
	}
	return params, errs
}

// validateParameterExpressions checks `ui:` expressions inside the form schema
// (e.g. ui:visibleIf, design §3.3). The form is rendered before any step runs,
// so only parameters and the opaque namespaces are in scope there.
func validateParameterExpressions(pages []ParameterPage, params map[string]bool) []ValidationError {
	scope := refScope{
		params:          params,
		stepIndex:       map[string]int{},
		stepActionNames: map[string]string{},
		actions:         DescriptorCatalog(nil),
		currentStep:     0,
	}
	var errs []ValidationError
	for i, page := range pages {
		names := make([]string, 0, len(page.Properties))
		for n := range page.Properties {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			base := fmt.Sprintf("spec.parameters[%d].properties.%s", i, n)
			var decoded any
			if err := json.Unmarshal(page.Properties[n], &decoded); err != nil {
				continue // already reported by validateParameters
			}
			for _, leaf := range stringLeaves(decoded, base) {
				errs = append(errs, scope.checkString(leaf.path, leaf.value)...)
			}
		}
	}
	return errs
}

func validateStep(def *Definition, idx int, step Step, params map[string]bool, stepIndex map[string]int, actions ActionCatalog) []ValidationError {
	base := fmt.Sprintf("spec.steps[%d]", idx)
	var errs []ValidationError

	if !stepIDRe.MatchString(step.ID) {
		errs = append(errs, ValidationError{Path: base + ".id", Message: fmt.Sprintf("step id must match %s, got %q", stepIDRe, step.ID)})
	} else if first, ok := stepIndex[step.ID]; ok && first != idx {
		errs = append(errs, ValidationError{Path: base + ".id", Message: fmt.Sprintf("duplicate step id %q (first declared at step %d)", step.ID, first)})
	}
	// step.Name, page titles and metadata text are intentionally literal: nothing
	// resolves them at run time, so an expression there would be a silent
	// passthrough. If the workflow ever renders them, add them to the reference
	// checks below at the same time.
	if strings.TrimSpace(step.Name) == "" {
		errs = append(errs, ValidationError{Path: base + ".name", Message: "is required"})
	}
	if HasExpression(step.Name) {
		errs = append(errs, ValidationError{Path: base + ".name", Message: "expressions are not supported in a step name"})
	}
	if step.Timeout != "" {
		// Positivity and the ceiling are checked HERE, not only when the step
		// runs: a bad timeout on step 3 would otherwise fail the run after
		// steps 1 and 2 had already created a repo and pushed to it.
		switch d, err := time.ParseDuration(step.Timeout); {
		case err != nil:
			errs = append(errs, ValidationError{Path: base + ".timeout", Message: fmt.Sprintf("is not a Go duration: %v", err)})
		case d <= 0:
			errs = append(errs, ValidationError{Path: base + ".timeout", Message: "must be positive"})
		case d > MaxStepTimeout:
			errs = append(errs, ValidationError{Path: base + ".timeout", Message: fmt.Sprintf("must not exceed %s", MaxStepTimeout)})
		}
	}

	var desc ActionDescriptor
	haveAction := false
	switch {
	case strings.TrimSpace(step.Action) == "":
		errs = append(errs, ValidationError{Path: base + ".action", Message: "action is required"})
	default:
		d, ok := actions.Descriptor(step.Action)
		if !ok {
			errs = append(errs, ValidationError{Path: base + ".action", Message: fmt.Sprintf("unknown action %q", step.Action)})
		} else {
			desc, haveAction = d, true
		}
	}

	scope := refScope{
		params:          params,
		stepIndex:       stepIndex,
		stepActionNames: stepActionNames(def),
		actions:         actions,
		currentStep:     idx,
		currentID:       step.ID,
	}

	if strings.TrimSpace(step.If) != "" {
		ref, err := SingleExpression(step.If)
		if err != nil {
			errs = append(errs, ValidationError{Path: base + ".if", Message: err.Error()})
		} else if e, bad := scope.checkRef(base+".if", ref); bad {
			errs = append(errs, e)
		}
	}

	decoded, decodeErr := decodeInput(step.Input)
	if decodeErr != nil {
		errs = append(errs, ValidationError{Path: base + ".input", Message: fmt.Sprintf("is not valid JSON: %v", decodeErr)})
		return errs
	}

	for _, k := range expressionKeys(decoded, base+".input") {
		errs = append(errs, ValidationError{Path: k, Message: "expressions are not supported in object keys"})
	}
	for _, leaf := range stringLeaves(decoded, base+".input") {
		errs = append(errs, scope.checkString(leaf.path, leaf.value)...)
	}

	if haveAction {
		errs = append(errs, validateLiteralInput(base+".input", decoded, desc)...)
	}
	return errs
}

func validateOutput(def *Definition, out *Output, params map[string]bool, stepIndex map[string]int, stepCount int, actions ActionCatalog) []ValidationError {
	if out == nil {
		return nil
	}
	// The output block is resolved after every step has run, so any step id is
	// a valid backward reference.
	scope := refScope{
		params:          params,
		stepIndex:       stepIndex,
		stepActionNames: stepActionNames(def),
		actions:         actions,
		currentStep:     stepCount,
		currentID:       "",
	}
	var errs []ValidationError
	for i, l := range out.Links {
		base := fmt.Sprintf("spec.output.links[%d]", i)
		if strings.TrimSpace(l.Title) == "" {
			errs = append(errs, ValidationError{Path: base + ".title", Message: "is required"})
		}
		hasURL := strings.TrimSpace(l.URL) != ""
		hasEntity := strings.TrimSpace(l.Entity) != ""
		switch {
		case hasURL && hasEntity:
			errs = append(errs, ValidationError{Path: base, Message: "set exactly one of `url` or `entity`, not both"})
		case !hasURL && !hasEntity:
			errs = append(errs, ValidationError{Path: base, Message: "set exactly one of `url` or `entity`"})
		}
		errs = append(errs, scope.checkString(base+".title", l.Title)...)
		errs = append(errs, scope.checkString(base+".url", l.URL)...)
		errs = append(errs, scope.checkString(base+".entity", l.Entity)...)
	}
	errs = append(errs, scope.checkString("spec.output.text", out.Text)...)
	return errs
}

// ---------------------------------------------------------------------------
// expression reference checking
// ---------------------------------------------------------------------------

type refScope struct {
	params          map[string]bool
	stepIndex       map[string]int
	stepActionNames map[string]string // step id -> action name
	actions         ActionCatalog
	currentStep     int
	currentID       string
}

func (s refScope) checkString(path, value string) []ValidationError {
	if !HasExpression(value) {
		return nil
	}
	refs, err := ExtractReferences(value)
	if err != nil {
		return []ValidationError{{Path: path, Message: err.Error()}}
	}
	var errs []ValidationError
	for _, ref := range refs {
		if e, bad := s.checkRef(path, ref); bad {
			errs = append(errs, e)
		}
	}
	return errs
}

// checkFilterOrder rejects a default() that is not the first filter. A missing
// path resolves to nil and every other filter errors on nil, so a later
// default never gets the chance to mask it. Putting default first loses
// nothing: it replaces the empty string too.
func checkFilterOrder(path string, ref Reference) (ValidationError, bool) {
	for i, f := range ref.Filters {
		if f.Name == filterDefault && i > 0 {
			return ValidationError{
				Path:    path,
				Message: fmt.Sprintf("default(...) must be the first filter in %q; a later default cannot mask a missing path", ref.Raw),
			}, true
		}
	}
	return ValidationError{}, false
}

func (s refScope) checkRef(path string, ref Reference) (ValidationError, bool) {
	fail := func(format string, args ...any) (ValidationError, bool) {
		return ValidationError{Path: path, Message: fmt.Sprintf(format, args...)}, true
	}
	if e, bad := checkFilterOrder(path, ref); bad {
		return e, true
	}
	p := ref.Path
	switch p[0] {
	case "user", "workspace", "template":
		// Opaque well-known namespaces, populated by the workflow (plan §3.2).
		return ValidationError{}, false
	case "run":
		if len(p) != 2 || p[1] != "id" {
			return fail("the run namespace only exposes `run.id`, got %q", strings.Join(p, "."))
		}
		return ValidationError{}, false
	case "parameters":
		if len(p) < 2 {
			return fail("`parameters` must reference a property, e.g. ${{ parameters.name }}")
		}
		if !s.params[p[1]] {
			return fail("no parameter named %q is declared on any page", p[1])
		}
		return ValidationError{}, false
	case "steps":
		if len(p) < 3 {
			return fail("invalid step reference %q: expected steps.<id>.output.<key>", strings.Join(p, "."))
		}
		if p[2] != "output" {
			return fail("invalid step reference %q: only `output` is readable from a step", strings.Join(p, "."))
		}
		idx, ok := s.stepIndex[p[1]]
		if !ok {
			return fail("reference to unknown step %q", p[1])
		}
		if s.currentID != "" && p[1] == s.currentID {
			return fail("step %q references itself", p[1])
		}
		if idx >= s.currentStep {
			return fail("step %q references a later step %q; steps run in array order", s.currentID, p[1])
		}
		if len(p) == 3 {
			return ValidationError{}, false // whole output object
		}
		return s.checkOutputKey(path, p[1], p[3])
	default:
		return fail("unknown namespace %q in expression %q", p[0], ref.Raw)
	}
}

func (s refScope) checkOutputKey(path, stepID, key string) (ValidationError, bool) {
	// The referenced step's action must declare the key. A step with an unknown
	// action already produced its own error; don't pile on.
	desc, ok := s.descriptorForStep(stepID)
	if !ok {
		return ValidationError{}, false
	}
	keys, err := schemaPropertyNames(desc.OutputSchema)
	if err != nil {
		return ValidationError{Path: path, Message: fmt.Sprintf("action %q has an unparsable output schema: %v", desc.Name, err)}, true
	}
	if len(keys) == 0 {
		return ValidationError{}, false
	}
	for _, k := range keys {
		if k == key {
			return ValidationError{}, false
		}
	}
	return ValidationError{
		Path:    path,
		Message: fmt.Sprintf("action %q does not declare output %q (available: %s)", desc.Name, key, strings.Join(keys, ", ")),
	}, true
}

func (s refScope) descriptorForStep(stepID string) (ActionDescriptor, bool) {
	name, ok := s.stepActionNames[stepID]
	if !ok {
		return ActionDescriptor{}, false
	}
	return s.actions.Descriptor(name)
}

// stepActionNames maps each step id to its declared action name, first
// declaration wins (a duplicate id is already reported separately).
func stepActionNames(def *Definition) map[string]string {
	out := make(map[string]string, len(def.Spec.Steps))
	for _, s := range def.Spec.Steps {
		if s.ID == "" {
			continue
		}
		if _, ok := out[s.ID]; !ok {
			out[s.ID] = s.Action
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// literal input validation
// ---------------------------------------------------------------------------

// decodeInput decodes a step's raw input. A missing or null input decodes to an
// empty object so required-property checks still apply.
func decodeInput(raw json.RawMessage) (any, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return map[string]any{}, nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	if decoded == nil {
		return map[string]any{}, nil
	}
	return decoded, nil
}

type stringLeaf struct {
	path  string
	value string
}

// stringLeaves walks a decoded JSON value and yields every string leaf with its
// dotted path. Map keys are visited in sorted order so findings are stable.
func stringLeaves(v any, path string) []stringLeaf {
	switch t := v.(type) {
	case string:
		return []stringLeaf{{path: path, value: t}}
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var out []stringLeaf
		for _, k := range keys {
			out = append(out, stringLeaves(t[k], path+"."+k)...)
		}
		return out
	case []any:
		var out []stringLeaf
		for i, item := range t {
			out = append(out, stringLeaves(item, fmt.Sprintf("%s[%d]", path, i))...)
		}
		return out
	default:
		return nil
	}
}

// validateLiteralInput checks the non-expression parts of a step input against
// the action's InputSchema.
//
// Expression-bearing values cannot be type-checked before a run, so they are
// removed from the instance and their names are removed from the corresponding
// `required` lists in a relaxed copy of the schema. Everything else — literal
// types, required-ness, additionalProperties — is enforced.
func validateLiteralInput(path string, decoded any, desc ActionDescriptor) []ValidationError {
	if len(desc.InputSchema) == 0 {
		return nil
	}
	var schema map[string]any
	if err := json.Unmarshal(desc.InputSchema, &schema); err != nil {
		return []ValidationError{{Path: path, Message: fmt.Sprintf("action %q has an unparsable input schema: %v", desc.Name, err)}}
	}

	var stripped [][]pathSeg
	instance, _ := stripExpressions(decoded, nil, &stripped)
	relaxSchema(schema, stripped)

	relaxed, err := json.Marshal(schema)
	if err != nil {
		return []ValidationError{{Path: path, Message: fmt.Sprintf("action %q has an unserialisable input schema: %v", desc.Name, err)}}
	}

	compiler := jsonschema.NewCompiler()
	url := "mem://orbit/scaffolder/" + desc.Name + "/input.json"
	if err := compiler.AddResource(url, strings.NewReader(string(relaxed))); err != nil {
		return []ValidationError{{Path: path, Message: fmt.Sprintf("action %q has an invalid input schema: %v", desc.Name, err)}}
	}
	compiled, err := compiler.Compile(url)
	if err != nil {
		return []ValidationError{{Path: path, Message: fmt.Sprintf("action %q has an invalid input schema: %v", desc.Name, err)}}
	}
	if err := compiled.Validate(instance); err != nil {
		var ve *jsonschema.ValidationError
		if ok := asValidationError(err, &ve); !ok {
			return []ValidationError{{Path: path, Message: err.Error()}}
		}
		return flattenSchemaErrors(path, ve)
	}
	return nil
}

// pathSeg is one step of a path into a decoded input value: either an object
// key or an array index.
type pathSeg struct {
	key   string
	index int
	isIdx bool
}

func keySeg(k string) pathSeg { return pathSeg{key: k} }
func idxSeg(i int) pathSeg    { return pathSeg{index: i, isIdx: true} }

func childPath(path []pathSeg, seg pathSeg) []pathSeg {
	out := make([]pathSeg, len(path), len(path)+1)
	copy(out, path)
	return append(out, seg)
}

// stripExpressions returns a copy of v with every expression-bearing leaf
// replaced by null, recording the replaced paths.
//
// Containers are rebuilt rather than passed through, in objects and arrays
// alike: an expression nested inside an object inside an array has to reach the
// schema as null, not as the literal `${{ ... }}` string it is written as.
// Only a leaf that is itself an expression collapses to null.
//
// Object keys are kept rather than deleted so `additionalProperties: false`
// still catches an input property the action does not declare, even when its
// value is an expression.
func stripExpressions(v any, path []pathSeg, stripped *[][]pathSeg) (any, bool) {
	switch t := v.(type) {
	case string:
		if HasExpression(t) {
			return nil, true
		}
		return t, false
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(t))
		for _, k := range keys {
			cp := childPath(path, keySeg(k))
			child, hasExpr := stripExpressions(t[k], cp, stripped)
			if hasExpr {
				*stripped = append(*stripped, cp)
			}
			out[k] = child
		}
		return out, false
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			cp := childPath(path, idxSeg(i))
			child, hasExpr := stripExpressions(item, cp, stripped)
			if hasExpr {
				*stripped = append(*stripped, cp)
			}
			out[i] = child
		}
		return out, false
	default:
		return v, false
	}
}

// relaxSchema loosens the subschema of every expression-valued location to
// `true`, so the null placeholder left by stripExpressions type-checks while
// `required` and `additionalProperties` keep their bite.
//
// It walks `properties`, a schema-valued `additionalProperties` (for objects
// whose keys are the template author's own names, e.g. fs:render's `values`),
// and `items` to reach the declaring node, then relaxes that location inside
// the node's combinator branches too. A location reachable only through `$ref`
// or `patternProperties` is left alone; the worst case there is a spurious
// finding on an exotic schema, and every action schema in this repo is a flat
// object.
func relaxSchema(schema map[string]any, stripped [][]pathSeg) {
	for _, p := range stripped {
		node := schema
		ok := true
		for _, seg := range p[:len(p)-1] {
			child, found := schemaChild(node, seg)
			if !found {
				ok = false
				break
			}
			node = child
		}
		if !ok {
			continue
		}
		last := p[len(p)-1]
		if last.isIdx {
			relaxItems(node, last.index)
		} else {
			relaxProperty(node, last.key)
		}
	}
}

// schemaChild descends one path segment into a schema node. A key not
// declared under `properties` falls back to a schema-valued
// `additionalProperties`, which governs every dynamically-named key alike
// (fs:render's `values`, keyed by the author's own variable names).
func schemaChild(node map[string]any, seg pathSeg) (map[string]any, bool) {
	if seg.isIdx {
		return schemaChildAtIndex(node, seg.index)
	}
	if props, ok := node["properties"].(map[string]any); ok {
		if child, ok := props[seg.key].(map[string]any); ok {
			return child, true
		}
	}
	if ap, ok := node["additionalProperties"].(map[string]any); ok {
		return ap, true
	}
	return nil, false
}

// schemaChildAtIndex returns the schema node governing one array element,
// splitting a shared `items` schema into a per-element `prefixItems` entry
// first so relaxing that element leaves its siblings fully checked.
func schemaChildAtIndex(node map[string]any, index int) (map[string]any, bool) {
	if arr, ok := node["items"].([]any); ok { // pre-2020 tuple form
		if index < len(arr) {
			if m, ok := arr[index].(map[string]any); ok {
				return m, true
			}
		}
		return nil, false
	}
	items, ok := node["items"].(map[string]any)
	if !ok {
		return nil, false
	}
	prefix := splitItems(node, items, index)
	m, ok := prefix[index].(map[string]any)
	return m, ok
}

// splitItems materialises `prefixItems` entries up to index, each an
// independent copy of the shared `items` schema, and returns the slice.
//
// Draft 2020-12 applies `prefixItems` positionally and `items` to the rest, so
// this is exact for the action schemas in this repo. A schema that pins an
// older draft would ignore `prefixItems`; none does.
func splitItems(node map[string]any, items map[string]any, index int) []any {
	prefix, _ := node["prefixItems"].([]any)
	for len(prefix) <= index {
		prefix = append(prefix, deepCopyJSON(items))
	}
	node["prefixItems"] = prefix
	return prefix
}

func deepCopyJSON(v map[string]any) map[string]any {
	raw, err := json.Marshal(v)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

// relaxProperty sets a declared property's subschema to `true` in node and in
// any combinator branch of node that declares it.
//
// A name not declared under `properties` is, by default, left alone so
// `additionalProperties` still rejects it as an undeclared property. But when
// `additionalProperties` is itself a schema (not `false`) — an object like
// fs:render's `values`, whose keys are the template author's own names rather
// than a fixed set — name IS one of those dynamic, legitimately-additional
// keys, and it is added to `properties` as `true` instead. JSON Schema
// resolves overlap between `properties` and `additionalProperties` in favour
// of `properties`, so this exempts only this one key from
// `additionalProperties` while every other dynamic key on the same object
// keeps being checked against it.
func relaxProperty(node map[string]any, name string) {
	if props, ok := node["properties"].(map[string]any); ok {
		if _, declared := props[name]; declared {
			props[name] = true
			forEachBranch(node, func(sub map[string]any) { relaxProperty(sub, name) })
			return
		}
	}
	if _, ok := node["additionalProperties"].(map[string]any); ok {
		props, ok := node["properties"].(map[string]any)
		if !ok {
			props = map[string]any{}
			node["properties"] = props
		}
		props[name] = true
	}
	forEachBranch(node, func(sub map[string]any) { relaxProperty(sub, name) })
}

// relaxItems relaxes one array element, leaving every other element checked.
func relaxItems(node map[string]any, index int) {
	switch items := node["items"].(type) {
	case map[string]any:
		prefix := splitItems(node, items, index)
		prefix[index] = true
	case []any:
		if index < len(items) {
			items[index] = true
		}
	}
	forEachBranch(node, func(sub map[string]any) { relaxItems(sub, index) })
}

func forEachBranch(node map[string]any, fn func(map[string]any)) {
	for _, key := range []string{"allOf", "anyOf", "oneOf"} {
		branches, ok := node[key].([]any)
		if !ok {
			continue
		}
		for _, b := range branches {
			if sub, ok := b.(map[string]any); ok {
				fn(sub)
			}
		}
	}
	for _, key := range []string{"if", "then", "else", "not"} {
		if sub, ok := node[key].(map[string]any); ok {
			fn(sub)
		}
	}
}

// expressionKeys reports the paths of object keys that contain an expression.
// Resolving keys would let one expression overwrite another's entry on
// collision, so the engine refuses them and the validator says so up front.
func expressionKeys(v any, path string) []string {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var out []string
		for _, k := range keys {
			if HasExpression(k) {
				out = append(out, path+"."+k)
			}
			out = append(out, expressionKeys(t[k], path+"."+k)...)
		}
		return out
	case []any:
		var out []string
		for i, item := range t {
			out = append(out, expressionKeys(item, fmt.Sprintf("%s[%d]", path, i))...)
		}
		return out
	default:
		return nil
	}
}

func asValidationError(err error, target **jsonschema.ValidationError) bool {
	ve, ok := err.(*jsonschema.ValidationError)
	if ok {
		*target = ve
	}
	return ok
}

// flattenSchemaErrors turns a jsonschema error tree into leaf findings, sorted
// so the result never depends on traversal or map order.
func flattenSchemaErrors(base string, ve *jsonschema.ValidationError) []ValidationError {
	var out []ValidationError
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) > 0 {
			for _, c := range e.Causes {
				walk(c)
			}
			return
		}
		out = append(out, ValidationError{
			Path:    base + instanceLocationToPath(e.InstanceLocation),
			Message: e.Message,
		})
	}
	walk(ve)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path != out[j].Path {
			return out[i].Path < out[j].Path
		}
		return out[i].Message < out[j].Message
	})
	return out
}

// instanceLocationToPath converts a JSON pointer ("/cfg/a") to the dotted form
// used by ValidationError.Path (".cfg.a").
func instanceLocationToPath(loc string) string {
	loc = strings.TrimPrefix(loc, "#")
	if loc == "" || loc == "/" {
		return ""
	}
	var b strings.Builder
	for _, seg := range strings.Split(strings.TrimPrefix(loc, "/"), "/") {
		seg = strings.ReplaceAll(strings.ReplaceAll(seg, "~1", "/"), "~0", "~")
		b.WriteString(".")
		b.WriteString(seg)
	}
	return b.String()
}
