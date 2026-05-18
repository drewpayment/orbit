// Package tooltemplate expands a registered AgentTool's parameterized
// template (shell command, http request, or composite of those) into one
// or more concrete primitive calls. The agent never executes a template
// directly — the workflow looks up the row, calls Expand here, and
// dispatches the result through the same activities (shell_exec,
// http_request) the built-in tools use.
//
// Substitution is intentionally simple: {{var}} placeholders reference
// keys in the agent-supplied args map. Shell-kind templates shell-quote
// substituted values to neutralize meta-characters; HTTP-kind templates
// JSON-quote them. Unknown placeholders fail the expansion so a typo or
// LLM hallucination shows up as an error rather than as silently dropped
// data.
package tooltemplate

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Kind enumerates the template shapes the registry supports. Composite
// is a sequence of shell or http primitives.
type Kind string

const (
	KindShell     Kind = "shell"
	KindHTTP      Kind = "http"
	KindComposite Kind = "composite"
)

// Call is one concrete primitive invocation produced by Expand.
type Call struct {
	Tool string         // "shell_exec" | "http_request"
	Args map[string]any // ready to feed to the workflow's tool dispatch
}

// ShellTemplate is the structured body for a shell-kind template.
type ShellTemplate struct {
	Command    string `json:"command"`
	WorkingDir string `json:"working_dir,omitempty"`
}

// HTTPTemplate is the structured body for an http-kind template.
type HTTPTemplate struct {
	Method  string            `json:"method,omitempty"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
}

// CompositeTemplate is a list of steps. Each step is one of the above.
type CompositeTemplate struct {
	Steps []CompositeStep `json:"steps"`
}

// CompositeStep is the shape of one entry in a composite template. The
// Kind field selects which body to use.
type CompositeStep struct {
	Kind  Kind             `json:"kind"`
	Shell *ShellTemplate   `json:"shell,omitempty"`
	HTTP  *HTTPTemplate    `json:"http,omitempty"`
}

// Expand turns one (kind, raw template JSON, args) tuple into the primitive
// calls the workflow should dispatch.
func Expand(kind Kind, templateJSON string, args map[string]any) ([]Call, error) {
	switch kind {
	case KindShell:
		var t ShellTemplate
		if err := json.Unmarshal([]byte(templateJSON), &t); err != nil {
			return nil, fmt.Errorf("decode shell template: %w", err)
		}
		return expandShell(t, args)
	case KindHTTP:
		var t HTTPTemplate
		if err := json.Unmarshal([]byte(templateJSON), &t); err != nil {
			return nil, fmt.Errorf("decode http template: %w", err)
		}
		return expandHTTP(t, args)
	case KindComposite:
		var t CompositeTemplate
		if err := json.Unmarshal([]byte(templateJSON), &t); err != nil {
			return nil, fmt.Errorf("decode composite template: %w", err)
		}
		out := []Call{}
		for i, step := range t.Steps {
			var stepCalls []Call
			var err error
			switch step.Kind {
			case KindShell:
				if step.Shell == nil {
					return nil, fmt.Errorf("composite step %d: shell body missing", i)
				}
				stepCalls, err = expandShell(*step.Shell, args)
			case KindHTTP:
				if step.HTTP == nil {
					return nil, fmt.Errorf("composite step %d: http body missing", i)
				}
				stepCalls, err = expandHTTP(*step.HTTP, args)
			default:
				return nil, fmt.Errorf("composite step %d: unsupported kind %q", i, step.Kind)
			}
			if err != nil {
				return nil, fmt.Errorf("composite step %d: %w", i, err)
			}
			out = append(out, stepCalls...)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("unsupported template kind %q", kind)
	}
}

func expandShell(t ShellTemplate, args map[string]any) ([]Call, error) {
	cmd, err := substitute(t.Command, args, shellQuote)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"command": cmd}
	if t.WorkingDir != "" {
		wd, err := substitute(t.WorkingDir, args, shellQuote)
		if err != nil {
			return nil, err
		}
		out["working_dir"] = wd
	}
	return []Call{{Tool: "shell_exec", Args: out}}, nil
}

func expandHTTP(t HTTPTemplate, args map[string]any) ([]Call, error) {
	method := t.Method
	if method == "" {
		method = "GET"
	}
	urlOut, err := substitute(t.URL, args, jsonStringEscape)
	if err != nil {
		return nil, err
	}
	body, err := substitute(t.Body, args, jsonStringEscape)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{}
	for k, v := range t.Headers {
		hv, err := substitute(v, args, jsonStringEscape)
		if err != nil {
			return nil, err
		}
		headers[k] = hv
	}
	return []Call{{Tool: "http_request", Args: map[string]any{
		"method":  method,
		"url":     urlOut,
		"headers": headers,
		"body":    body,
	}}}, nil
}

// placeholderRE matches {{ name }} or {{name}} with optional surrounding
// whitespace. Names are alphanumeric + underscore, ASCII only.
var placeholderRE = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

// ErrMissingArg is returned when a template references a placeholder for
// which no value was supplied. The agent sees this as a tool error and can
// retry with the right args.
var ErrMissingArg = errors.New("template references unknown arg")

// substitute walks every {{var}} placeholder in s and replaces it with
// quote(value). Unknown vars fail.
func substitute(s string, args map[string]any, quote func(string) string) (string, error) {
	if s == "" {
		return "", nil
	}
	var firstErr error
	out := placeholderRE.ReplaceAllStringFunc(s, func(match string) string {
		if firstErr != nil {
			return ""
		}
		sub := placeholderRE.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		name := sub[1]
		raw, ok := args[name]
		if !ok {
			firstErr = fmt.Errorf("%w: %q", ErrMissingArg, name)
			return ""
		}
		return quote(stringify(raw))
	})
	if firstErr != nil {
		return "", firstErr
	}
	return out, nil
}

// shellQuote produces a single-quoted bash literal. Nothing in s is
// interpreted by the shell; embedded single quotes are escaped via the
// classic '\'' trick.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// jsonStringEscape returns s with backslash, double-quote, and control
// chars escaped per JSON string rules; suitable for embedding inside an
// HTTP body that's already JSON, or for a header value that we then
// transmit raw.
func jsonStringEscape(s string) string {
	b, _ := json.Marshal(s)
	// Strip the surrounding quotes; we want the inner value only because
	// callers compose this into a larger string (URL, header, body).
	if len(b) >= 2 {
		return string(b[1 : len(b)-1])
	}
	return s
}

func stringify(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	case bool:
		if x {
			return "true"
		}
		return "false"
	case json.Number:
		return x.String()
	default:
		b, _ := json.Marshal(v)
		s := string(b)
		// Strip surrounding quotes for plain string values.
		if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
			return s[1 : len(s)-1]
		}
		return s
	}
}

// PlaceholderNames returns the set of {{var}} names in a template, sorted.
// Useful for validating an inputSchema against a template at registration
// time (every placeholder must appear as a property in the schema).
func PlaceholderNames(s string) []string {
	matches := placeholderRE.FindAllStringSubmatch(s, -1)
	seen := map[string]struct{}{}
	for _, m := range matches {
		seen[m[1]] = struct{}{}
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
