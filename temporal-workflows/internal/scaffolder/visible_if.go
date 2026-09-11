package scaffolder

import (
	"regexp"
	"strconv"
	"strings"
)

// EvaluateVisibleIf evaluates a `ui:visibleIf` expression against a flat
// `parameters.*` value bag (unprefixed field names → values).
//
// This MUST stay behaviourally identical to orbit-www's two `ui:visibleIf`
// evaluators — `orbit-www/src/components/forms/schema-form/visible-if.ts`
// (SchemaForm's own client-side copy) and
// `orbit-www/src/lib/scaffolder/visible-if.ts` (the server-side copy backing
// `validateRunParameters`), which those files' doc comments already require
// to stay identical to EACH OTHER. This is a THIRD independent port (the Go
// engine has its own much richer `${{ }}` expression language in expr.go,
// with fundamentally different failure semantics — it errors on an
// unresolved path rather than failing open/closed to a bool — so it is not
// reused here). Any semantic change in any one of the three must be
// mirrored in the other two, and in all three test files.
//
// Parses the same small subset of the `${{ }}` expression language: a bare
// field reference (`parameters.foo`, truthy check), negation
// (`!parameters.foo`), and equality (`parameters.foo == 'bar'` /
// `parameters.foo == 3`).
//
// Two deliberate choices, both carried over from the TS originals:
//   - A referenced field that is MISSING from values defaults to HIDDEN
//     (false) for a bare reference or an equality check — a field that
//     depends on a not-yet-filled field should stay hidden.
//   - A MALFORMED expression, or a negation whose referenced field is
//     missing, fails OPEN (true, visible) — a typo, or a field that hasn't
//     resolved yet behind a `!`, should never silently lock a field out
//     with no way to reach it.
func EvaluateVisibleIf(expression string, values map[string]any) bool {
	trimmed := strings.TrimSpace(expression)
	if trimmed == "" {
		return true
	}

	m := visibleIfWrapperRe.FindStringSubmatch(trimmed)
	if m == nil {
		return true // malformed wrapper — fail open
	}
	body := strings.TrimSpace(m[1])
	if body == "" {
		return true
	}

	if strings.HasPrefix(body, "!") {
		inner := strings.TrimSpace(body[1:])
		found, value := visibleIfResolveRef(inner, values)
		if !found {
			return true // can't resolve — fail open (not a missing-field case)
		}
		return !visibleIfTruthy(value)
	}

	if idx := strings.Index(body, "=="); idx >= 0 {
		lhsRaw := strings.TrimSpace(body[:idx])
		rhsRaw := strings.TrimSpace(body[idx+2:])
		literal, ok := visibleIfParseLiteral(rhsRaw)
		if !ok {
			return true // right-hand side isn't a recognizable literal — fail open
		}
		found, value := visibleIfResolveRef(lhsRaw, values)
		if !found {
			return false // missing referenced field — hidden
		}
		return visibleIfEqual(value, literal)
	}

	found, value := visibleIfResolveRef(body, values)
	if !found {
		if !strings.HasPrefix(body, "parameters.") {
			return true // not a recognizable parameters.* reference — fail open
		}
		return false // a parameters.* reference whose field is absent — hidden
	}
	return visibleIfTruthy(value)
}

var (
	visibleIfWrapperRe = regexp.MustCompile(`^\$\{\{\s*(.*?)\s*\}\}$`)
	visibleIfRefRe     = regexp.MustCompile(`^parameters\.([A-Za-z0-9_.]+)$`)
	visibleIfNumberRe  = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
)

// visibleIfResolveRef resolves a `parameters.<dotted.path>` reference against
// values. Only `parameters.*` refs are supported, matching the TS originals.
func visibleIfResolveRef(ref string, values map[string]any) (found bool, value any) {
	m := visibleIfRefRe.FindStringSubmatch(ref)
	if m == nil {
		return false, nil
	}
	var current any = values
	for _, segment := range strings.Split(m[1], ".") {
		asMap, ok := current.(map[string]any)
		if !ok {
			return false, nil
		}
		next, exists := asMap[segment]
		if !exists {
			return false, nil
		}
		current = next
	}
	return true, current
}

func visibleIfTruthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return len(v) > 0
	case float64:
		return v != 0
	case int:
		return v != 0
	case []any:
		return len(v) > 0
	default:
		return true
	}
}

// visibleIfParseLiteral parses a `true`/`false`/number/quoted-string literal,
// mirroring parseLiteral in the TS originals.
func visibleIfParseLiteral(raw string) (any, bool) {
	switch raw {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	if visibleIfNumberRe.MatchString(raw) {
		if f, err := strconv.ParseFloat(raw, 64); err == nil {
			return f, true
		}
	}
	if len(raw) >= 2 {
		first, last := raw[0], raw[len(raw)-1]
		if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
			return raw[1 : len(raw)-1], true
		}
	}
	return nil, false
}

func visibleIfEqual(value, literal any) bool {
	switch lv := literal.(type) {
	case string:
		sv, ok := value.(string)
		return ok && sv == lv
	case float64:
		switch nv := value.(type) {
		case float64:
			return nv == lv
		case int:
			return float64(nv) == lv
		default:
			return false
		}
	case bool:
		bv, ok := value.(bool)
		return ok && bv == lv
	default:
		return false
	}
}
