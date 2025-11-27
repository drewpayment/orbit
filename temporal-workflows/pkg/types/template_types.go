// Package types provides shared types for template instantiation workflows
package types

// TemplateInstantiationInput contains all parameters needed for template instantiation
type TemplateInstantiationInput struct {
	TemplateID       string            // ID of the template being instantiated
	WorkspaceID      string            // Workspace where repo will be created
	TargetOrg        string            // GitHub org/user for the new repo
	RepositoryName   string            // Name for the new repository
	Description      string            // Description for the new repository
	IsPrivate        bool              // Whether the repo should be private
	IsGitHubTemplate bool              // True if template repo has GitHub template enabled
	SourceRepoOwner  string            // Owner of the source template repo
	SourceRepoName   string            // Name of the source template repo
	SourceRepoURL    string            // Full URL of source repo (for non-GitHub templates)
	Variables        map[string]string // Template variables to substitute
	UserID           string            // ID of user initiating instantiation
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
