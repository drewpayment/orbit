// Package safety contains the policy code that classifies agent-emitted
// commands and HTTP requests as destructive — i.e., as actions that the
// workflow must gate behind explicit human approval before execution.
//
// The policy is intentionally simple: a list of regular-expression patterns
// matched against the bash command string the agent emits via shell_exec.
// Anything that matches surfaces an approval prompt of kind
// "destructive_command" via the existing request_approval pathway. The
// workflow blocks until a workspace admin / owner approves, and feeds the
// resolution back into the agent's conversation as a regular tool result.
//
// The point of the auto-gate is defense in depth: the system prompt tells
// the agent to call request_approval before destructive commands, but if
// the agent forgets (or is talked into skipping by prompt injection), the
// workflow still surfaces a human gate. Failing closed is the desired
// posture.
package safety

import (
	"regexp"
	"strings"
)

// destructivePatterns matches commands that should always require human
// approval. The list is conservative — false positives are fine (one
// extra approval click) and false negatives are expensive (silent
// destructive action). New entries should err toward over-matching.
var destructivePatterns = []destructivePattern{
	{name: "rm -rf", re: regexp.MustCompile(`\brm\s+(?:-[^\s]*[rR][^\s]*[fF][^\s]*|-[^\s]*[fF][^\s]*[rR][^\s]*|-r[fF]?|-f[rR]?)\b`)},
	{name: "rm /", re: regexp.MustCompile(`\brm\s+(?:-\S+\s+)?\/(?:\s|$)`)},
	{name: "terraform destroy", re: regexp.MustCompile(`\bterraform\s+destroy\b`)},
	{name: "pulumi destroy", re: regexp.MustCompile(`\bpulumi\s+destroy\b`)},
	{name: "kubectl delete", re: regexp.MustCompile(`\bkubectl\s+(?:\S+\s+)*delete\b`)},
	{name: "helm uninstall", re: regexp.MustCompile(`\bhelm\s+(?:uninstall|delete)\b`)},
	{name: "az delete", re: regexp.MustCompile(`\baz\s+(?:\S+\s+)*delete\b`)},
	{name: "az group delete", re: regexp.MustCompile(`\baz\s+group\s+delete\b`)},
	{name: "gcloud delete", re: regexp.MustCompile(`\bgcloud\s+(?:\S+\s+)*delete\b`)},
	{name: "aws delete-*", re: regexp.MustCompile(`\baws\s+\S+\s+delete-\S+\b`)},
	{name: "docker rm", re: regexp.MustCompile(`\bdocker\s+(?:rm\b|rmi\b|system\s+prune\b|volume\s+rm\b|network\s+rm\b)`)},
	{name: "drop/truncate", re: regexp.MustCompile(`(?i)\b(?:drop|truncate)\s+(?:table|database|schema|index|view)\b`)},
	{name: "delete from", re: regexp.MustCompile(`(?i)\bdelete\s+from\b`)},
	{name: "redirect to disk", re: regexp.MustCompile(`>\s*\/dev\/(?:sd|nvme|hd|disk)`)},
	{name: "mkfs", re: regexp.MustCompile(`\bmkfs(?:\.\S+)?\b`)},
	{name: "shutdown / reboot", re: regexp.MustCompile(`(?i)\b(?:shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b`)},
	{name: "fork bomb", re: regexp.MustCompile(`:\(\)\s*\{\s*:\s*\|\s*:&?\s*\}`)},
	{name: "curl | sh", re: regexp.MustCompile(`(?:curl|wget)\s+(?:[^|]*?)\|\s*(?:sh|bash|zsh)\b`)},
	{name: "git push --force", re: regexp.MustCompile(`\bgit\s+push\s+(?:[^|;&]*?)(?:--force|-f)\b`)},
	{name: "git reset --hard", re: regexp.MustCompile(`\bgit\s+reset\s+(?:[^|;&]*?)--hard\b`)},
}

type destructivePattern struct {
	name string
	re   *regexp.Regexp
}

// Classification is the verdict for one shell command.
type Classification struct {
	// Destructive is true when at least one pattern matches.
	Destructive bool
	// Patterns lists the matched pattern names (in source order, deduped).
	// Surfaced to the human reviewer so they know exactly what tripped the
	// gate.
	Patterns []string
}

// ClassifyShell scans command for destructive operations. The matcher is
// case-sensitive against POSIX-shell syntax — agents that try to evade
// detection by upper-casing parts of a command will fail because the
// shell wouldn't run that anyway. We DO use the case-insensitive flag
// inline on patterns where SQL or shutdown tokens are commonly written
// in mixed case.
func ClassifyShell(command string) Classification {
	if strings.TrimSpace(command) == "" {
		return Classification{}
	}
	out := Classification{}
	seen := map[string]struct{}{}
	for _, p := range destructivePatterns {
		if p.re.MatchString(command) {
			if _, dup := seen[p.name]; !dup {
				out.Patterns = append(out.Patterns, p.name)
				seen[p.name] = struct{}{}
			}
			out.Destructive = true
		}
	}
	return out
}

// PatternNames returns the canonical list of pattern names. Useful for
// admin UIs ("commands matching any of: …").
func PatternNames() []string {
	names := make([]string, 0, len(destructivePatterns))
	for _, p := range destructivePatterns {
		names = append(names, p.name)
	}
	return names
}
