package actions

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// sortedKeys keeps log attribute order stable regardless of Go's randomised map
// iteration, so run logs are diffable between runs.
func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// requireWithinWorkDir rejects a target path unless workDir is set and
// target resolves to workDir itself or somewhere under it. A step's `path`
// input reaches the worker through a template author's `${{ }}` expression
// — untrusted relative to the worker's filesystem — so any action that
// writes to an author-supplied path (fs:render in particular) must not
// operate outside the run's own scratch directory.
func requireWithinWorkDir(workDir, target string) error {
	if strings.TrimSpace(workDir) == "" {
		return fmt.Errorf("run has no work directory")
	}
	absWorkDir, err := filepath.Abs(workDir)
	if err != nil {
		return fmt.Errorf("resolve work directory: %w", err)
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return fmt.Errorf("resolve `path`: %w", err)
	}
	if absTarget == absWorkDir {
		return nil
	}
	rel, err := filepath.Rel(absWorkDir, absTarget)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("`path` must be inside the run's work directory")
	}
	return nil
}
