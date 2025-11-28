// Package types provides shared types for template instantiation workflows
package types

// TemplateInstantiationInput contains all parameters needed for template instantiation
type TemplateInstantiationInput struct {
	TemplateID       string            `json:"templateId"`       // ID of the template being instantiated
	WorkspaceID      string            `json:"workspaceId"`      // Workspace where repo will be created
	TargetOrg        string            `json:"targetOrg"`        // GitHub org/user for the new repo
	RepositoryName   string            `json:"repositoryName"`   // Name for the new repository
	Description      string            `json:"description"`      // Description for the new repository
	IsPrivate        bool              `json:"isPrivate"`        // Whether the repo should be private
	IsGitHubTemplate bool              `json:"isGitHubTemplate"` // True if template repo has GitHub template enabled
	SourceRepoOwner  string            `json:"sourceRepoOwner"`  // Owner of the source template repo
	SourceRepoName   string            `json:"sourceRepoName"`   // Name of the source template repo
	SourceRepoURL    string            `json:"sourceRepoUrl"`    // Full URL of source repo (for non-GitHub templates)
	Variables        map[string]string `json:"variables"`        // Template variables to substitute
	UserID           string            `json:"userId"`           // ID of user initiating instantiation
	InstallationID   string            `json:"installationId"`   // GitHub App installation ID for authentication
}

// TemplateInstantiationResult contains the workflow result
type TemplateInstantiationResult struct {
	Status   string // "completed", "failed"
	RepoURL  string // URL of the created repository
	RepoName string // Name of the created repository
	Error    string // Error message if failed
}

// InstantiationProgress tracks workflow progress for query handler
type InstantiationProgress struct {
	CurrentStep  string
	StepsTotal   int
	StepsCurrent int
	Message      string
}
