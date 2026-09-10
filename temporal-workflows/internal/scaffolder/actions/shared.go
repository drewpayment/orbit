package actions

import "sort"

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
