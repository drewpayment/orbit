// Package types provides shared types for workflows
package types

// Build status constants
const (
	BuildStatusAnalyzing     = "analyzing"
	BuildStatusAwaitingInput = "awaiting_input"
	BuildStatusBuilding      = "building"
	BuildStatusPushing       = "pushing"
	BuildStatusSuccess       = "success"
	BuildStatusFailed        = "failed"
)

// Signal and query names
const (
	SignalPackageManagerSelected = "package_manager_selected"
	QueryBuildState              = "build_state"
)

// BuildState represents the current workflow state (for queries)
type BuildState struct {
	Status              string   `json:"status"`
	NeedsPackageManager bool     `json:"needsPackageManager"`
	AvailableChoices    []string `json:"availableChoices"`
	SelectedPM          string   `json:"selectedPM"`
	Error               string   `json:"error,omitempty"`
}

// PackageManagerInfo from analysis
type PackageManagerInfo struct {
	Detected         bool   `json:"detected"`
	Name             string `json:"name"`
	Source           string `json:"source"`
	Lockfile         string `json:"lockfile"`
	RequestedVersion string `json:"requestedVersion"`
	VersionSupported bool   `json:"versionSupported"`
	SupportedRange   string `json:"supportedRange"`
}

// BuildWorkflowInput contains all parameters for image building
type BuildWorkflowInput struct {
	RequestID   string              `json:"requestId"`
	AppID       string              `json:"appId"`
	WorkspaceID string              `json:"workspaceId"`
	UserID      string              `json:"userId"`
	RepoURL     string              `json:"repoUrl"`
	Ref         string              `json:"ref"`
	Registry    BuildRegistryConfig `json:"registry"`
	// Optional overrides
	LanguageVersion string            `json:"languageVersion,omitempty"`
	BuildCommand    string            `json:"buildCommand,omitempty"`
	StartCommand    string            `json:"startCommand,omitempty"`
	BuildEnv        map[string]string `json:"buildEnv,omitempty"`
	ImageTag        string            `json:"imageTag,omitempty"`
}

// BuildRegistryConfig contains registry configuration
type BuildRegistryConfig struct {
	Type       string `json:"type"` // "ghcr" or "acr"
	URL        string `json:"url"`
	Repository string `json:"repository"`
	Token      string `json:"token"`
	Username   string `json:"username,omitempty"` // For ACR
}

// BuildWorkflowResult contains the build result
type BuildWorkflowResult struct {
	Status         string               `json:"status"` // analyzing, building, success, failed
	ImageURL       string               `json:"imageUrl,omitempty"`
	ImageDigest    string               `json:"imageDigest,omitempty"`
	Error          string               `json:"error,omitempty"`
	DetectedConfig *DetectedBuildConfig `json:"detectedConfig,omitempty"`
}

// DetectedBuildConfig contains Railpack-detected build settings
type DetectedBuildConfig struct {
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
}

// BuildProgress tracks build workflow progress for query handler
type BuildProgress struct {
	CurrentStep  string `json:"currentStep"`
	StepsTotal   int    `json:"stepsTotal"`
	StepsCurrent int    `json:"stepsCurrent"`
	Message      string `json:"message"`
}

// AnalyzeRepositoryResult contains the repository analysis result
type AnalyzeRepositoryResult struct {
	Detected        bool                `json:"detected"`
	Error           string              `json:"error,omitempty"`
	Language        string              `json:"language,omitempty"`
	LanguageVersion string              `json:"languageVersion,omitempty"`
	Framework       string              `json:"framework,omitempty"`
	BuildCommand    string              `json:"buildCommand,omitempty"`
	StartCommand    string              `json:"startCommand,omitempty"`
	PackageManager  *PackageManagerInfo `json:"packageManager,omitempty"`
}
