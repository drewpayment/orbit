package templating

import (
	"encoding/json"
	"strings"
	"text/template"
	"unicode"
)

// FuncMap returns the curated set of template helper functions available to
// authored templates. Deliberately hand-rolled (not Sprig) to keep the
// exposed surface small and avoid env/expandenv-class functions reaching
// user-authored content. See Decision 10 in the Phase 0 plan.
func FuncMap() template.FuncMap {
	return template.FuncMap{
		"lower":      strings.ToLower,
		"upper":      strings.ToUpper,
		"title":      titleCase,
		"trim":       strings.TrimSpace,
		"trimPrefix": func(s, prefix string) string { return strings.TrimPrefix(s, prefix) },
		"trimSuffix": func(s, suffix string) string { return strings.TrimSuffix(s, suffix) },
		"replace":    func(s, old, new string) string { return strings.ReplaceAll(s, old, new) },
		"default":    defaultFn,
		"quote":      func(s string) string { return `"` + s + `"` },
		"kebabCase":  kebabCase,
		"snakeCase":  snakeCase,
		"pascalCase": pascalCase,
		"camelCase":  camelCase,
		"contains":   func(s, substr string) bool { return strings.Contains(s, substr) },
		"hasPrefix":  func(s, prefix string) bool { return strings.HasPrefix(s, prefix) },
		"hasSuffix":  func(s, suffix string) bool { return strings.HasSuffix(s, suffix) },
		"join":       func(elems []string, sep string) string { return strings.Join(elems, sep) },
		"split":      func(s, sep string) []string { return strings.Split(s, sep) },
		"indent":     indent,
		"nindent":    nindent,
		"toJson":     toJSON,
	}
}

func titleCase(s string) string {
	return strings.Title(s) //nolint:staticcheck // simple ASCII word-titling, no locale needs
}

func defaultFn(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}

func indent(spaces int, s string) string {
	pad := strings.Repeat(" ", spaces)
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = pad + line
	}
	return strings.Join(lines, "\n")
}

func nindent(spaces int, s string) string {
	return "\n" + indent(spaces, s)
}

func toJSON(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// splitWords breaks a string on '-', '_', whitespace, and camel/Pascal case
// boundaries so kebabCase/snakeCase/pascalCase/camelCase share one notion of
// "word" regardless of the input's original casing convention.
func splitWords(s string) []string {
	var words []string
	var current strings.Builder

	flush := func() {
		if current.Len() > 0 {
			words = append(words, current.String())
			current.Reset()
		}
	}

	runes := []rune(s)
	for i, r := range runes {
		switch {
		case r == '-' || r == '_' || unicode.IsSpace(r):
			flush()
		case unicode.IsUpper(r):
			// Start a new word on an uppercase letter unless it continues an
			// existing all-caps run (e.g. "ID" in "MyIDService" stays with
			// the previous word only when the next rune is also uppercase
			// followed by a lowercase letter, i.e. the classic acronym case).
			if i > 0 {
				prev := runes[i-1]
				nextLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
				if unicode.IsLower(prev) || unicode.IsDigit(prev) {
					flush()
				} else if unicode.IsUpper(prev) && nextLower {
					flush()
				}
			}
			current.WriteRune(r)
		default:
			current.WriteRune(r)
		}
	}
	flush()
	return words
}

func kebabCase(s string) string {
	words := splitWords(s)
	for i, w := range words {
		words[i] = strings.ToLower(w)
	}
	return strings.Join(words, "-")
}

func snakeCase(s string) string {
	words := splitWords(s)
	for i, w := range words {
		words[i] = strings.ToLower(w)
	}
	return strings.Join(words, "_")
}

func pascalCase(s string) string {
	words := splitWords(s)
	var b strings.Builder
	for _, w := range words {
		if w == "" {
			continue
		}
		lower := strings.ToLower(w)
		b.WriteString(strings.ToUpper(lower[:1]) + lower[1:])
	}
	return b.String()
}

func camelCase(s string) string {
	p := pascalCase(s)
	if p == "" {
		return p
	}
	return strings.ToLower(p[:1]) + p[1:]
}
