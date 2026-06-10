package providers

import (
	"fmt"
	"sort"
	"sync"
)

var (
	registryMu sync.RWMutex
	registry   = map[string]Factory{}
)

// Register installs a Factory under the given name. Safe to call from init().
// Subsequent calls with the same name overwrite the prior factory.
func Register(name string, factory Factory) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[name] = factory
}

// Build returns a Provider for the registered name.
func Build(name string, cfg Config) (Provider, error) {
	registryMu.RLock()
	factory, ok := registry[name]
	registryMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("providers: unknown LLM provider %q (registered: %v)", name, Registered())
	}
	return factory(cfg)
}

// Registered returns the sorted list of currently registered provider names.
// Useful for error messages and admin UIs.
func Registered() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()
	names := make([]string, 0, len(registry))
	for n := range registry {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
