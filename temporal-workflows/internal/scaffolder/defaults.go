package scaffolder

import "encoding/json"

// rawSchemaProperty is the subset of a JSON Schema property this package
// needs to apply defaults: its declared `default` (if any), for an
// `object`-typed property its nested `properties` so defaults can be filled
// recursively, and its inline `ui:visibleIf` (design §3.1 wire format — `ui:*`
// keys live directly on the property object) so a hidden field's default can
// be dropped again — see ApplyParameterDefaults's doc comment.
type rawSchemaProperty struct {
	Type        string                     `json:"type"`
	Default     json.RawMessage            `json:"default"`
	Properties  map[string]json.RawMessage `json:"properties"`
	UIVisibleIf string                     `json:"ui:visibleIf"`
}

// ApplyParameterDefaults fills in each parameter page's declared JSON Schema
// `default` for any key absent from params, then drops any TOP-LEVEL key this
// call itself just defaulted whose `ui:visibleIf` evaluates false against the
// fully-defaulted result — a hidden field's default must never leak into the
// expression context a step can read, matching what the client's SchemaForm
// already does for its own submit path. Returns the result; never mutates the
// map passed in, including any nested object map inside it (a
// partially-provided nested object is copied before defaults are filled into
// it, so the caller's own nested map is left untouched).
//
// A key already present in params always wins, including an explicit
// `false`/`""`/`0`: only *absence* of the key counts as "not provided" (and so
// eligible to be filled AND drop-checked). A property with no declared
// `default` is left absent rather than invented. `object`-typed properties
// with their own nested `properties` are filled recursively (mirrors the
// client SchemaForm's recursion into nested object groups). `ui:visibleIf` is
// deliberately only checked at the top level, matching the vocabulary's
// existing scope (nested object properties don't carry `ui:*` directives
// today).
//
// Note: only a value THIS CALL defaulted is drop-checked — a value the caller
// (or an earlier page) explicitly provided for a currently-hidden field is
// left alone; whether an explicit-but-hidden value should ever reach
// persistence is a separate, pre-existing concern this does not change.
//
// This is the single authoritative place defaults are applied for the Go
// engine — both real runs and dry runs/plans build their expression context
// from its result, so a caller cannot see different defaulting behavior
// depending on which path invoked the workflow.
func ApplyParameterDefaults(def Definition, params map[string]any) map[string]any {
	out := make(map[string]any, len(params))
	for k, v := range params {
		out[k] = v
	}

	newlyDefaulted := map[string]rawSchemaProperty{}
	for _, page := range def.Spec.Parameters {
		fillPageDefaults(page.Properties, out, newlyDefaulted)
	}

	for name, prop := range newlyDefaulted {
		if prop.UIVisibleIf != "" && !EvaluateVisibleIf(prop.UIVisibleIf, out) {
			delete(out, name)
		}
	}

	return out
}

// fillPageDefaults fills out from properties' declared defaults. record, when
// non-nil, collects every TOP-LEVEL property this call defaults (name → its
// parsed schema, so its ui:visibleIf can be checked once every page has been
// filled) — callers pass nil for a nested recursive fill, since ui:visibleIf
// has no meaning below the top level.
func fillPageDefaults(properties map[string]json.RawMessage, out map[string]any, record map[string]rawSchemaProperty) {
	for name, raw := range properties {
		var prop rawSchemaProperty
		if err := json.Unmarshal(raw, &prop); err != nil {
			continue
		}

		existing, provided := out[name]
		if !provided {
			if prop.Default != nil {
				var def any
				if err := json.Unmarshal(prop.Default, &def); err == nil {
					out[name] = def
					if record != nil {
						record[name] = prop
					}
				}
				continue
			}
			if prop.Type == "object" && len(prop.Properties) > 0 {
				nested := map[string]any{}
				fillPageDefaults(prop.Properties, nested, nil)
				if len(nested) > 0 {
					out[name] = nested
				}
			}
			continue
		}

		if prop.Type == "object" && len(prop.Properties) > 0 {
			if nestedVal, ok := existing.(map[string]any); ok {
				// Copy before filling — `existing` is the caller's own nested
				// map (params was only shallow-copied one level up in
				// ApplyParameterDefaults), so filling it in place would leak
				// defaults into the caller's map for any key it left unset.
				nestedCopy := make(map[string]any, len(nestedVal))
				for k, v := range nestedVal {
					nestedCopy[k] = v
				}
				fillPageDefaults(prop.Properties, nestedCopy, nil)
				out[name] = nestedCopy
			}
		}
	}
}
