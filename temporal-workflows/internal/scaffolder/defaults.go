package scaffolder

import "encoding/json"

// rawSchemaProperty is the subset of a JSON Schema property this package
// needs to apply defaults: its declared `default` (if any) and, for an
// `object`-typed property, its nested `properties` so defaults can be filled
// recursively.
type rawSchemaProperty struct {
	Type       string                     `json:"type"`
	Default    json.RawMessage            `json:"default"`
	Properties map[string]json.RawMessage `json:"properties"`
}

// ApplyParameterDefaults fills in each parameter page's declared JSON Schema
// `default` for any key absent from params, and returns the result — it
// never mutates the map passed in, including any nested object map inside it
// (a partially-provided nested object is copied before defaults are filled
// into it, so the caller's own nested map is left untouched).
//
// A key already present in params always wins, including an explicit
// `false`/`""`/`0`: only *absence* of the key counts as "not provided". A
// property with no declared `default` is left absent rather than invented.
// `object`-typed properties with their own nested `properties` are filled
// recursively (mirrors the client SchemaForm's recursion into nested
// object groups).
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
	for _, page := range def.Spec.Parameters {
		applyPageDefaults(page.Properties, out)
	}
	return out
}

func applyPageDefaults(properties map[string]json.RawMessage, out map[string]any) {
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
				}
				continue
			}
			if prop.Type == "object" && len(prop.Properties) > 0 {
				nested := map[string]any{}
				applyPageDefaults(prop.Properties, nested)
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
				applyPageDefaults(prop.Properties, nestedCopy)
				out[name] = nestedCopy
			}
		}
	}
}
