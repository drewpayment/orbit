// Package templating provides the template rendering engine used to
// substitute variables into template file contents and path segment names
// during template instantiation.
//
// It supports two authoring styles at once:
//   - Legacy bare tokens: {{SERVICE_NAME}} (no leading dot), rewritten to
//     {{.SERVICE_NAME}} before parsing, but ONLY when SERVICE_NAME is an
//     exact key present in the vars map passed to Render/RenderName.
//   - Standard Go text/template syntax: {{.SERVICE_NAME}}, pipelines
//     ({{.SERVICE_NAME | pascalCase}}), and control flow
//     ({{- if .Foo }}...{{- end }}), left untouched by the preprocessor and
//     passed straight to text/template.
//
// Anything that isn't an exact bare-token match (a pipe, a leading dot, a
// dash-trim marker, etc.) is left alone by design, so Helm-style chart
// syntax in files not marked raw survives the preprocessing pass.
package templating

import (
	"bytes"
	"regexp"
	"text/template"
)

// bareTokenPattern matches {{ KEY }} with optional internal whitespace and no
// leading dot, pipe, dash-trim marker, or other template syntax. The capture
// must be an exact key in the vars map before it is rewritten.
var bareTokenPattern = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

// preprocess rewrites bare {{KEY}} tokens to {{.KEY}} for every KEY that is
// an exact key in vars. Everything else in content is left byte-for-byte
// unchanged.
func preprocess(content string, vars map[string]string) string {
	return bareTokenPattern.ReplaceAllStringFunc(content, func(match string) string {
		key := bareTokenPattern.FindStringSubmatch(match)[1]
		if _, ok := vars[key]; !ok {
			return match
		}
		return "{{." + key + "}}"
	})
}

func newTemplate(name string) *template.Template {
	return template.New(name).Option("missingkey=error").Funcs(FuncMap())
}

// Render substitutes vars into content. Bare {{KEY}} tokens are rewritten to
// {{.KEY}} first (only for KEY present in vars); everything else is passed
// to text/template unmodified, so Helm-style {{ .Values.x }} / {{- if }} /
// {{ range }} constructs are preserved for files not marked raw.
//
// Parse and Execute errors are both surfaced as a single error; the caller
// decides whether a failure here is fatal or skippable for the file in
// question. The engine itself stays opinion-free about that.
func Render(content string, vars map[string]string) (string, error) {
	prepared := preprocess(content, vars)

	tmpl, err := newTemplate("content").Parse(prepared)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, vars); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// RenderName applies the same substitution rules as Render to a single path
// segment (a file or directory base name).
func RenderName(name string, vars map[string]string) (string, error) {
	return Render(name, vars)
}
