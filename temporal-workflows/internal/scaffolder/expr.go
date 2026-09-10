package scaffolder

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// Ctx is the evaluation context for `${{ }}` expressions. Every namespace is a
// plain map so the evaluator can never reach into Go structs — template authors
// are not necessarily platform-team and `visibility: public` templates cross
// tenants (design §3.4, plan §4.1).
type Ctx struct {
	Parameters map[string]any
	Steps      map[string]StepOutput
	User       map[string]any
	Workspace  map[string]any
	Template   map[string]any
	RunID      string
}

// StepOutput is one completed step's output, keyed by step id in Ctx.Steps.
type StepOutput struct {
	Output map[string]any
}

// Filter is one element of an expression's pipe chain.
type Filter struct {
	Name   string
	Arg    any
	HasArg bool
}

// Reference is a parsed `${{ }}` expression: a dotted path plus its filters.
type Reference struct {
	Raw        string   // the expression body, e.g. `parameters.name | upper`
	Path       []string // dotted path segments, e.g. ["parameters", "name"]
	Filters    []Filter
	HasDefault bool // a default(x) filter is present, so a missing path is tolerated
}

const (
	exprOpen  = "${{"
	exprClose = "}}"
)

// HasExpression reports whether s contains at least one `${{` opener.
func HasExpression(s string) bool { return strings.Contains(s, exprOpen) }

// ExtractReferences parses every expression in s. It is used by the static
// validator, which needs the reference graph without an evaluation context.
func ExtractReferences(s string) ([]Reference, error) {
	spans, err := scanExpressions(s)
	if err != nil {
		return nil, err
	}
	refs := make([]Reference, 0, len(spans))
	for _, sp := range spans {
		refs = append(refs, sp.ref)
	}
	return refs, nil
}

// Resolve walks v (string, map, slice, or scalar) and replaces every `${{ ... }}`
// found in string leaves. A whole-string match preserves the resolved value's
// type; a partial match stringifies. Input is never mutated. An unresolvable
// path is an error, never a silent empty string (design §3.2).
func Resolve(ctx Ctx, v any) (any, error) {
	return resolveValue(ctx, v, "")
}

// ResolveJSON resolves every expression inside a raw JSON document, returning a
// new raw JSON document. Nil or empty input passes through untouched.
func ResolveJSON(ctx Ctx, raw json.RawMessage) (json.RawMessage, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decode input: %w", err)
	}
	resolved, err := Resolve(ctx, decoded)
	if err != nil {
		return nil, err
	}
	out, err := json.Marshal(resolved)
	if err != nil {
		return nil, fmt.Errorf("encode resolved input: %w", err)
	}
	return out, nil
}

// EvalBool evaluates a step's `if` expression. The expression must be a single
// whole-string `${{ }}` expression or a bare dotted path; mixed literal text is
// rejected because `if` is single-expression truthiness only (plan §13).
func EvalBool(ctx Ctx, expr string) (bool, error) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return false, fmt.Errorf("if: empty expression")
	}
	if !HasExpression(trimmed) {
		trimmed = exprOpen + " " + trimmed + " " + exprClose
	}
	spans, err := scanExpressions(trimmed)
	if err != nil {
		return false, fmt.Errorf("if: %w", err)
	}
	if len(spans) != 1 || spans[0].start != 0 || spans[0].end != len(trimmed) {
		return false, fmt.Errorf("if: must be a single expression, got %q", expr)
	}
	val, err := evalReference(ctx, spans[0].ref)
	if err != nil {
		return false, fmt.Errorf("if: %w", err)
	}
	return truthy(val), nil
}

// ---------------------------------------------------------------------------
// walking
// ---------------------------------------------------------------------------

func resolveValue(ctx Ctx, v any, path string) (any, error) {
	switch t := v.(type) {
	case string:
		out, err := resolveString(ctx, t)
		if err != nil {
			return nil, wrapPath(path, err)
		}
		return out, nil
	case map[string]any:
		// Sorted key order keeps error reporting independent of Go's randomised
		// map iteration, so a broken definition always reports the same error.
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(t))
		for _, k := range keys {
			child, err := resolveValue(ctx, t[k], joinPath(path, k))
			if err != nil {
				return nil, err
			}
			out[k] = child
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			child, err := resolveValue(ctx, item, fmt.Sprintf("%s[%d]", path, i))
			if err != nil {
				return nil, err
			}
			out[i] = child
		}
		return out, nil
	default:
		return v, nil
	}
}

func joinPath(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + "." + key
}

func wrapPath(path string, err error) error {
	if path == "" {
		return err
	}
	return fmt.Errorf("at %s: %w", path, err)
}

// resolveString resolves every expression in s. The resolved value of an
// expression is returned verbatim and is never re-scanned for expressions, so a
// parameter whose value happens to contain `${{ }}` cannot escape its scope.
func resolveString(ctx Ctx, s string) (any, error) {
	if !HasExpression(s) {
		return s, nil
	}
	spans, err := scanExpressions(s)
	if err != nil {
		return nil, err
	}
	if len(spans) == 0 {
		return s, nil
	}
	if len(spans) == 1 && spans[0].start == 0 && spans[0].end == len(s) {
		return evalReference(ctx, spans[0].ref)
	}
	var b strings.Builder
	cursor := 0
	for _, sp := range spans {
		b.WriteString(s[cursor:sp.start])
		val, err := evalReference(ctx, sp.ref)
		if err != nil {
			return nil, err
		}
		str, err := stringify(val)
		if err != nil {
			return nil, err
		}
		b.WriteString(str)
		cursor = sp.end
	}
	b.WriteString(s[cursor:])
	return b.String(), nil
}

// ---------------------------------------------------------------------------
// scanning + parsing
// ---------------------------------------------------------------------------

type exprSpan struct {
	start int // index of "${{"
	end   int // index just past "}}"
	ref   Reference
}

// scanExpressions is a hand-written scanner rather than a regular expression:
// it tolerates `}}` inside quoted filter arguments and has no backtracking.
func scanExpressions(s string) ([]exprSpan, error) {
	var spans []exprSpan
	for i := 0; i < len(s); {
		open := strings.Index(s[i:], exprOpen)
		if open < 0 {
			break
		}
		open += i
		closeAt, err := findClose(s, open+len(exprOpen))
		if err != nil {
			return nil, err
		}
		body := s[open+len(exprOpen) : closeAt]
		ref, err := parseReference(body)
		if err != nil {
			return nil, err
		}
		spans = append(spans, exprSpan{start: open, end: closeAt + len(exprClose), ref: ref})
		i = closeAt + len(exprClose)
	}
	return spans, nil
}

func findClose(s string, from int) (int, error) {
	var quote byte
	for i := from; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '\'', '"':
			quote = c
		case '}':
			if i+1 < len(s) && s[i+1] == '}' {
				return i, nil
			}
		}
	}
	return 0, fmt.Errorf("unterminated expression: missing %q in %q", exprClose, s)
}

func parseReference(body string) (Reference, error) {
	ref := Reference{Raw: strings.TrimSpace(body)}
	segments := splitTopLevel(body, '|')
	pathPart := strings.TrimSpace(segments[0])
	if pathPart == "" {
		return ref, fmt.Errorf("empty expression: %q", exprOpen+body+exprClose)
	}
	path := strings.Split(pathPart, ".")
	for _, seg := range path {
		if !validIdent(seg) {
			return ref, fmt.Errorf("invalid path %q in expression %q", pathPart, ref.Raw)
		}
	}
	ref.Path = path
	for _, raw := range segments[1:] {
		f, err := parseFilter(strings.TrimSpace(raw), ref.Raw)
		if err != nil {
			return ref, err
		}
		if f.Name == filterDefault {
			ref.HasDefault = true
		}
		ref.Filters = append(ref.Filters, f)
	}
	return ref, nil
}

func validIdent(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		switch {
		case r == '_' || unicode.IsLetter(r):
		case (unicode.IsDigit(r) || r == '-') && i > 0:
		default:
			return false
		}
	}
	return true
}

func parseFilter(s, raw string) (Filter, error) {
	if s == "" {
		return Filter{}, fmt.Errorf("empty filter in expression %q", raw)
	}
	name, arg := s, ""
	hasArg := false
	if open := strings.IndexByte(s, '('); open >= 0 {
		if !strings.HasSuffix(s, ")") {
			return Filter{}, fmt.Errorf("malformed filter %q in expression %q", s, raw)
		}
		name = strings.TrimSpace(s[:open])
		arg = strings.TrimSpace(s[open+1 : len(s)-1])
		hasArg = true
	}
	if !validIdent(name) {
		return Filter{}, fmt.Errorf("invalid filter name %q in expression %q", name, raw)
	}
	if _, ok := filterNames[name]; !ok {
		return Filter{}, fmt.Errorf("unknown filter %q in expression %q", name, raw)
	}
	f := Filter{Name: name, HasArg: hasArg}
	if hasArg {
		f.Arg = parseLiteral(arg)
	}
	return f, nil
}

// splitTopLevel splits on sep, ignoring separators inside quotes or parentheses.
func splitTopLevel(s string, sep byte) []string {
	var (
		out   []string
		start int
		quote byte
		depth int
	)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '\'', '"':
			quote = c
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		case sep:
			if depth == 0 {
				out = append(out, s[start:i])
				start = i + 1
			}
		}
	}
	return append(out, s[start:])
}

func parseLiteral(s string) any {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	switch s {
	case "true":
		return true
	case "false":
		return false
	case "null", "nil":
		return nil
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	return s
}

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------

func evalReference(ctx Ctx, ref Reference) (any, error) {
	val, found, err := lookup(ctx, ref.Path)
	if err != nil {
		return nil, err
	}
	if !found {
		if !ref.HasDefault {
			return nil, fmt.Errorf("unresolved expression path %q", strings.Join(ref.Path, "."))
		}
		val = nil
	}
	for _, f := range ref.Filters {
		val, err = applyFilter(f, val, ref)
		if err != nil {
			return nil, err
		}
	}
	// A path that exists but holds null resolves to null: that is a real value,
	// not a broken reference. Stringifying it later is what fails loudly.
	return val, nil
}

// lookup returns (value, found, structuralError). A structural error (unknown
// namespace, malformed steps reference) is never maskable by default().
func lookup(ctx Ctx, path []string) (any, bool, error) {
	joined := strings.Join(path, ".")
	switch path[0] {
	case "parameters":
		return descend(ctx.Parameters, path[1:], joined)
	case "user":
		return descend(ctx.User, path[1:], joined)
	case "workspace":
		return descend(ctx.Workspace, path[1:], joined)
	case "template":
		return descend(ctx.Template, path[1:], joined)
	case "run":
		return descend(map[string]any{"id": ctx.RunID}, path[1:], joined)
	case "steps":
		if len(path) < 3 {
			return nil, false, fmt.Errorf("invalid steps reference %q: expected steps.<id>.output.<key>", joined)
		}
		if path[2] != "output" {
			return nil, false, fmt.Errorf("invalid steps reference %q: expected `output` after the step id", joined)
		}
		step, ok := ctx.Steps[path[1]]
		if !ok {
			return nil, false, nil
		}
		return descend(step.Output, path[3:], joined)
	default:
		return nil, false, fmt.Errorf("unknown namespace %q in expression %q", path[0], joined)
	}
}

func descend(root map[string]any, rest []string, joined string) (any, bool, error) {
	var cur any = root
	if root == nil {
		return nil, false, nil
	}
	for _, key := range rest {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false, nil // traversal into a scalar: treated as missing
		}
		cur, ok = m[key]
		if !ok {
			return nil, false, nil
		}
	}
	_ = joined
	return cur, true, nil
}

const filterDefault = "default"

var filterNames = map[string]struct{}{
	"lower":       {},
	"upper":       {},
	"kebabCase":   {},
	"pascalCase":  {},
	"snakeCase":   {},
	filterDefault: {},
	"json":        {},
}

// FilterNames returns the supported filter names, sorted. Exposed so the TS
// side and the authoring UI can stay in sync with the engine.
func FilterNames() []string {
	out := make([]string, 0, len(filterNames))
	for n := range filterNames {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func applyFilter(f Filter, val any, ref Reference) (any, error) {
	if f.Name == filterDefault {
		if !f.HasArg {
			return nil, fmt.Errorf("filter default() requires an argument in expression %q", ref.Raw)
		}
		if val == nil || val == "" {
			return f.Arg, nil
		}
		return val, nil
	}
	if val == nil {
		return nil, fmt.Errorf("cannot apply filter %q to unresolved path %q", f.Name, strings.Join(ref.Path, "."))
	}
	if f.Name == "json" {
		b, err := json.Marshal(val)
		if err != nil {
			return nil, fmt.Errorf("filter json on %q: %w", strings.Join(ref.Path, "."), err)
		}
		return string(b), nil
	}
	s, err := stringify(val)
	if err != nil {
		return nil, fmt.Errorf("filter %q on %q: %w", f.Name, strings.Join(ref.Path, "."), err)
	}
	switch f.Name {
	case "lower":
		return strings.ToLower(s), nil
	case "upper":
		return strings.ToUpper(s), nil
	case "kebabCase":
		return kebabCase(s), nil
	case "pascalCase":
		return pascalCase(s), nil
	case "snakeCase":
		return snakeCase(s), nil
	default:
		return nil, fmt.Errorf("unknown filter %q in expression %q", f.Name, ref.Raw)
	}
}

func stringify(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case bool:
		return strconv.FormatBool(t), nil
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64), nil
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32), nil
	case int:
		return strconv.Itoa(t), nil
	case int32:
		return strconv.FormatInt(int64(t), 10), nil
	case int64:
		return strconv.FormatInt(t, 10), nil
	case json.Number:
		return t.String(), nil
	case nil:
		return "", fmt.Errorf("cannot stringify null")
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return "", fmt.Errorf("cannot stringify %T: %w", v, err)
		}
		return string(b), nil
	}
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		s := strings.TrimSpace(strings.ToLower(t))
		return s != "" && s != "false" && s != "0"
	case float64:
		return t != 0
	case int:
		return t != 0
	case int64:
		return t != 0
	case []any:
		return len(t) > 0
	case map[string]any:
		return len(t) > 0
	default:
		return true
	}
}

// ---------------------------------------------------------------------------
// case filters
// ---------------------------------------------------------------------------

// splitWords splits an identifier on separators, lower→upper transitions and
// acronym boundaries ("HTTPServer" → ["HTTP", "Server"]).
func splitWords(s string) []string {
	runes := []rune(s)
	var (
		words []string
		cur   []rune
	)
	flush := func() {
		if len(cur) > 0 {
			words = append(words, string(cur))
			cur = nil
		}
	}
	for i, r := range runes {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			flush()
			continue
		}
		if unicode.IsUpper(r) && i > 0 {
			prev := runes[i-1]
			switch {
			case unicode.IsLower(prev) || unicode.IsDigit(prev):
				flush()
			case unicode.IsUpper(prev) && i+1 < len(runes) && unicode.IsLower(runes[i+1]):
				flush()
			}
		}
		cur = append(cur, r)
	}
	flush()
	return words
}

func kebabCase(s string) string { return joinWords(s, "-", strings.ToLower) }
func snakeCase(s string) string { return joinWords(s, "_", strings.ToLower) }

func joinWords(s, sep string, transform func(string) string) string {
	words := splitWords(s)
	for i, w := range words {
		words[i] = transform(w)
	}
	return strings.Join(words, sep)
}

func pascalCase(s string) string {
	words := splitWords(s)
	var b strings.Builder
	for _, w := range words {
		r := []rune(strings.ToLower(w))
		r[0] = unicode.ToUpper(r[0])
		b.WriteString(string(r))
	}
	return b.String()
}
