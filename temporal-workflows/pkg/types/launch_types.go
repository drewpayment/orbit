package types

// LaunchWorkflowInput contains all parameters needed to execute a launch workflow
type LaunchWorkflowInput struct {
	LaunchID          string                 `json:"launchId"`
	TemplateSlug      string                 `json:"templateSlug"`
	CloudAccountID    string                 `json:"cloudAccountId"`
	Provider          string                 `json:"provider"`
	Region            string                 `json:"region"`
	Parameters        map[string]interface{} `json:"parameters"`
	ApprovalRequired  bool                   `json:"approvalRequired"`
	AutoApproved      bool                   `json:"autoApproved"`
	LaunchedBy        string                 `json:"launchedBy"`
	PulumiProjectPath string                 `json:"pulumiProjectPath"`
	WorkspaceID       string                 `json:"workspaceId"`
}

// LaunchProgress tracks launch workflow progress for query handler
type LaunchProgress struct {
	Status      string   `json:"status"`
	CurrentStep int      `json:"currentStep"`
	TotalSteps  int      `json:"totalSteps"`
	Message     string   `json:"message"`
	Percentage  float64  `json:"percentage"`
	Logs        []string `json:"logs"`
}

// ApprovalSignalInput contains the data sent when approving or rejecting a launch
type ApprovalSignalInput struct {
	Approved   bool   `json:"approved"`
	ApprovedBy string `json:"approvedBy"`
	Notes      string `json:"notes"`
}

// DeorbitSignalInput contains the data sent when requesting infrastructure teardown
type DeorbitSignalInput struct {
	RequestedBy string `json:"requestedBy"`
	Reason      string `json:"reason"`
}

// AbortSignalInput contains the data sent when aborting a launch
type AbortSignalInput struct {
	RequestedBy string `json:"requestedBy"`
}

// ProvisionInfraInput contains all parameters needed to provision infrastructure
type ProvisionInfraInput struct {
	LaunchID       string                 `json:"launchId"`
	StackName      string                 `json:"stackName"`
	TemplatePath   string                 `json:"templatePath"`
	CloudAccountID string                 `json:"cloudAccountId"`
	Provider       string                 `json:"provider"`
	Region         string                 `json:"region"`
	Parameters     map[string]interface{} `json:"parameters"`
}

// ProvisionInfraResult contains the result of infrastructure provisioning
type ProvisionInfraResult struct {
	Outputs map[string]interface{} `json:"outputs"`
	Summary []string               `json:"summary"`
}

// DestroyInfraInput contains all parameters needed to destroy infrastructure
type DestroyInfraInput struct {
	LaunchID       string `json:"launchId"`
	StackName      string `json:"stackName"`
	TemplatePath   string `json:"templatePath"`
	CloudAccountID string `json:"cloudAccountId"`
	Provider       string `json:"provider"`
	Region         string `json:"region"`
}

// UpdateLaunchStatusInput contains the data for updating a launch's status
type UpdateLaunchStatusInput struct {
	LaunchID string `json:"launchId"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
}

// StoreLaunchOutputsInput contains the data for storing launch outputs
type StoreLaunchOutputsInput struct {
	LaunchID string                 `json:"launchId"`
	Outputs  map[string]interface{} `json:"outputs"`
}

// DeployToLaunchInput contains parameters for deploying an app to Launch infrastructure
type DeployToLaunchInput struct {
	DeploymentID    string                 `json:"deploymentId"`
	LaunchID        string                 `json:"launchId"`
	Strategy        string                 `json:"strategy"`
	CloudAccountID  string                 `json:"cloudAccountId"`
	Provider        string                 `json:"provider"`
	RepoURL         string                 `json:"repoUrl"`
	Branch          string                 `json:"branch"`
	BuildCommand    string                 `json:"buildCommand"`
	OutputDirectory string                 `json:"outputDirectory"`
	LaunchOutputs   map[string]interface{} `json:"launchOutputs"`
	BuildEnv        map[string]string      `json:"buildEnv"`
}

// DeployToLaunchResult contains the result of a deploy-to-launch operation
type DeployToLaunchResult struct {
	DeployedURL string   `json:"deployedUrl"`
	FilesCount  int      `json:"filesCount"`
	Summary     []string `json:"summary"`
}

// UpdateDeploymentStatusInput contains data for updating a deployment's status
type UpdateDeploymentStatusInput struct {
	DeploymentID string `json:"deploymentId"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
	URL          string `json:"url,omitempty"`
}
