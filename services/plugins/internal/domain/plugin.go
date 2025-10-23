package domain

import "time"

// Plugin represents a Backstage plugin in the domain
type Plugin struct {
	ID           string
	Name         string
	Description  string
	Category     string // "api-catalog", "ci-cd", "infrastructure", "cloud-resources"
	Enabled      bool
	APIBasePath  string // e.g., "/api/argocd"
	Config       map[string]string
	Metadata     PluginMetadata
	Status       PluginStatus
}

// PluginMetadata contains plugin metadata
type PluginMetadata struct {
	Version              string
	DocumentationURL     string
	BackstagePackage     string
	RequiredConfigKeys   []string
	SupportedFeatures    []string
}

// PluginStatus contains runtime status of a plugin
type PluginStatus struct {
	Healthy        bool
	StatusMessage  string
	LastCheckedAt  time.Time
	RequestCount   int32
	ErrorCount     int32
}

// PluginCategory represents plugin categories
type PluginCategory string

const (
	CategoryAPICatalog    PluginCategory = "api-catalog"
	CategoryCICD          PluginCategory = "ci-cd"
	CategoryInfrastructure PluginCategory = "infrastructure"
	CategoryCloudResources PluginCategory = "cloud-resources"
)

// IsValidCategory checks if a category string is valid
func IsValidCategory(category string) bool {
	switch PluginCategory(category) {
	case CategoryAPICatalog, CategoryCICD, CategoryInfrastructure, CategoryCloudResources:
		return true
	default:
		return false
	}
}
