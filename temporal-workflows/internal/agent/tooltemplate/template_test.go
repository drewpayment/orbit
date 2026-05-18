package tooltemplate

import (
	"errors"
	"strings"
	"testing"
)

func TestExpand_ShellSubstitutesAndQuotes(t *testing.T) {
	calls, err := Expand(KindShell, `{"command":"az appservice create -g {{region}}-rg -n {{app_name}}"}`, map[string]any{
		"region":   "westus",
		"app_name": "my; rm -rf /; app",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 1 || calls[0].Tool != "shell_exec" {
		t.Fatalf("calls = %+v", calls)
	}
	cmd := calls[0].Args["command"].(string)
	if !strings.Contains(cmd, "'westus'-rg") {
		t.Errorf("region not single-quoted: %q", cmd)
	}
	// Embedded shell metas in app_name MUST be neutralized by single quotes.
	if !strings.Contains(cmd, "'my; rm -rf /; app'") {
		t.Errorf("dangerous app_name not quoted: %q", cmd)
	}
}

func TestExpand_ShellWorkingDirAlsoSubstituted(t *testing.T) {
	calls, err := Expand(KindShell, `{"command":"ls","working_dir":"repo/{{slug}}"}`, map[string]any{
		"slug": "owner_repo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := calls[0].Args["working_dir"].(string); got != "repo/'owner_repo'" {
		t.Errorf("working_dir = %q", got)
	}
}

func TestExpand_ShellMissingArgErrors(t *testing.T) {
	_, err := Expand(KindShell, `{"command":"echo {{nope}}"}`, map[string]any{})
	if !errors.Is(err, ErrMissingArg) {
		t.Errorf("err = %v, want ErrMissingArg", err)
	}
}

func TestExpand_HTTPSubstitutesAcrossFields(t *testing.T) {
	tmpl := `{"method":"POST","url":"https://api.example.com/{{org}}/projects","headers":{"Authorization":"Bearer {{token}}"},"body":"{\"name\":\"{{name}}\"}"}`
	calls, err := Expand(KindHTTP, tmpl, map[string]any{
		"org":   "acme",
		"token": "secret",
		"name":  "demo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 1 || calls[0].Tool != "http_request" {
		t.Fatalf("calls = %+v", calls)
	}
	args := calls[0].Args
	if got := args["url"].(string); got != "https://api.example.com/acme/projects" {
		t.Errorf("url = %q", got)
	}
	hdrs := args["headers"].(map[string]string)
	if hdrs["Authorization"] != "Bearer secret" {
		t.Errorf("auth header = %q", hdrs["Authorization"])
	}
	if got := args["body"].(string); got != `{"name":"demo"}` {
		t.Errorf("body = %q", got)
	}
}

func TestExpand_Composite(t *testing.T) {
	tmpl := `{"steps":[
        {"kind":"shell","shell":{"command":"echo {{a}}"}},
        {"kind":"shell","shell":{"command":"echo {{b}}"}}
    ]}`
	calls, err := Expand(KindComposite, tmpl, map[string]any{"a": "1", "b": "2"})
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 {
		t.Fatalf("calls = %+v", calls)
	}
}

func TestPlaceholderNames(t *testing.T) {
	names := PlaceholderNames("{{a}} and {{ b }} and {{a}} again")
	if len(names) != 2 || names[0] != "a" || names[1] != "b" {
		t.Errorf("names = %v", names)
	}
}

func TestExpand_RejectsUnsupportedKind(t *testing.T) {
	_, err := Expand("python", `{}`, map[string]any{})
	if err == nil {
		t.Fatal("expected error for unsupported kind")
	}
}

func TestExpand_ShellQuoteHandlesEmbeddedSingles(t *testing.T) {
	calls, _ := Expand(KindShell, `{"command":"echo {{x}}"}`, map[string]any{"x": "a'b"})
	cmd := calls[0].Args["command"].(string)
	if !strings.Contains(cmd, `'a'\''b'`) {
		t.Errorf("embedded single not escaped: %q", cmd)
	}
}
