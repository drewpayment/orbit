// Package agentcontract holds the wire constants and payload types shared
// between the InfrastructureAgentWorkflow, the agent activities, the gRPC
// AgentService server (in services/repository), and the temporal-side helper
// services. Living under pkg/ rather than internal/ lets sibling Go modules
// (the repository service) import the contract.
package agentcontract

import "time"

// Signal names.
const (
	SignalUserMessage  = "AgentUserMessage"
	SignalApproval     = "AgentApproval"
	SignalAbort        = "AgentAbort"
	SignalTokenStream  = "AgentTokenStream"
	SignalToolFinished = "AgentToolFinished"
)

// Query names.
const (
	QuerySnapshot    = "AgentSnapshot"
	QueryEventsSince = "AgentEventsSince"
	QueryHasFinished = "AgentHasFinished"
)

// Activity names.
const (
	ActivityLLMNextStep = "LLMNextStep"
)

// Workflow names. These match the Go function name registered on the worker.
const (
	WorkflowInfrastructureAgent = "InfrastructureAgentWorkflow"
)

// Tool names exposed to the LLM. Spike 1 surface plus the Spike 2 sandbox
// tools (shell_exec, http_request, file IO, repo_inspect). Spikes 3+ layer in
// request_approval, register_tool, etc.
const (
	ToolProposeToUser = "propose_to_user"
	ToolDone          = "done"

	ToolShellExec       = "shell_exec"
	ToolHTTPRequest     = "http_request"
	ToolReadFile        = "read_file"
	ToolWriteFile       = "write_file"
	ToolListDir         = "list_dir"
	ToolRepoInspect     = "repo_inspect"
	ToolRequestApproval = "request_approval"
	ToolRegisterTool    = "register_tool"
	ToolStartHealthCheck = "start_child_health_check"

	// Orbit-aware introspection tools. The agent uses these to discover what
	// apps and cloud accounts exist in the current workspace without leaving
	// the sandbox. None of these return secrets — credentials reach the
	// sandbox only as env vars projected at run-start.
	ToolOrbitListApps          = "orbit_list_apps"
	ToolOrbitGetApp            = "orbit_get_app"
	ToolOrbitListCloudAccounts = "orbit_list_cloud_accounts"
)

// ApprovalKind classifies HITL gates the agent surfaces. The chat UI uses
// this to pick the right card style; admin auditing groups by kind.
const (
	ApprovalKindCustom            = "custom"
	ApprovalKindProposal          = "proposal"
	ApprovalKindDestructiveCmd    = "destructive_command"
	ApprovalKindToolRegistration  = "tool_registration"
)

// Activity names for Spike 2 sandbox + IO activities.
const (
	ActivityEnsureSandbox    = "EnsureSandbox"
	ActivityTeardownSandbox  = "TeardownSandbox"
	ActivitySandboxedShell   = "SandboxedShell"
	ActivitySandboxReadFile  = "SandboxReadFile"
	ActivitySandboxWriteFile = "SandboxWriteFile"
	ActivitySandboxListDir   = "SandboxListDir"
	ActivityHTTPRequest      = "HTTPRequest"
	ActivityRepoInspect      = "RepoInspect"
)

// Activity names for Spike 4 tool registry.
const (
	ActivityListApprovedAgentTools  = "ListApprovedAgentTools"
	ActivityRegisterPendingAgentTool = "RegisterPendingAgentTool"
	ActivityResolveAgentTool         = "ResolveAgentTool"
)

// Activity names for Spike 5 audit trail.
const (
	ActivityUpdateAgentRun = "UpdateAgentRun"
)

// Activity names for Orbit introspection — back the orbit_* tools above.
const (
	ActivityOrbitListApps          = "OrbitListApps"
	ActivityOrbitGetApp            = "OrbitGetApp"
	ActivityOrbitListCloudAccounts = "OrbitListCloudAccounts"
)

// Event kinds emitted into the workflow's event log.
const (
	EventKindConversationTurn = "conversation_turn"
	EventKindTokenDelta       = "token_delta"
	EventKindProposalUpdate   = "proposal_update"
	EventKindApprovalRequest  = "approval_request"
	EventKindApprovalResolved = "approval_resolution"
	EventKindStatusUpdate     = "status_update"
)

// InfrastructureAgentInput is the workflow input.
type InfrastructureAgentInput struct {
	AgentRunID    string
	WorkspaceID   string
	RepositoryID  string
	UserID        string
	LLMProviderID string
	InitialPrompt string

	SystemPrompt string

	// HTTPAllowlist restricts the http_request tool to a host suffix list.
	// Empty (the default) falls back to a conservative set of public hosts
	// in the workflow itself.
	HTTPAllowlist []string

	// SandboxImage overrides the default sandbox image (k8s only). Empty
	// uses the executor's default.
	SandboxImage string

	// SandboxEnv is the env to project into the sandbox (workspace cloud
	// creds, etc.). The activity layer is responsible for not logging values.
	SandboxEnv map[string]string

	// GitHubToken is forwarded to the repo_inspect tool when fetching from
	// the GitHub API. May be empty for public repos.
	GitHubToken string

	History         []ConversationTurn
	Events          []AgentEvent
	NextSequence    uint64
	IterationsSoFar int
}

// ConversationTurn captures one message in the agent transcript.
type ConversationTurn struct {
	TurnID     string           `json:"turn_id"`
	Role       string           `json:"role"`
	Content    string           `json:"content"`
	ToolCalls  []ToolCallRecord `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolName   string           `json:"tool_name,omitempty"`
	Timestamp  time.Time        `json:"timestamp"`
}

// ToolCallRecord is the serializable form of a tool call.
type ToolCallRecord struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

// Proposal is the latest agent proposal (rendered in the chat).
type Proposal struct {
	ProposalID   string    `json:"proposal_id"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"`
	BodyMarkdown string    `json:"body_markdown"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AgentEvent is one item in the workflow's event log, surfaced via query.
type AgentEvent struct {
	Sequence  uint64         `json:"sequence"`
	EmittedAt time.Time      `json:"emitted_at"`
	Kind      string         `json:"kind"`
	Payload   map[string]any `json:"payload"`
}

// AgentSnapshot is what the chat UI reads on initial mount.
type AgentSnapshot struct {
	Status           string             `json:"status"`
	Conversation     []ConversationTurn `json:"conversation"`
	StreamingPartial string             `json:"streaming_partial"`
	StreamingTurnID  string             `json:"streaming_turn_id"`
	Proposal         *Proposal          `json:"proposal,omitempty"`
	PendingApprovals []PendingApproval  `json:"pending_approvals"`
	LatestSequence   uint64             `json:"latest_sequence"`
	Backend          string             `json:"backend"`
	Model            string             `json:"model"`
}

// PendingApproval is exposed for HITL UI rendering.
type PendingApproval struct {
	ApprovalID   string         `json:"approval_id"`
	Kind         string         `json:"kind"`
	Title        string         `json:"title"`
	BodyMarkdown string         `json:"body_markdown"`
	Payload      map[string]any `json:"payload,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

// ProviderConfigSummary is the non-sensitive subset of a workspace's LLM
// provider config returned by the ProviderLoader. The activity uses it for
// telemetry; the workflow uses it to surface the backend/model in the
// snapshot query so the UI can label which model an answer came from.
type ProviderConfigSummary struct {
	Backend string `json:"backend"` // "anthropic" | "openai_compat"
	Model   string `json:"model"`
}

// TokenStreamSignalPayload is the body of SignalTokenStream.
type TokenStreamSignalPayload struct {
	TurnID string `json:"turn_id"`
	Delta  string `json:"delta"`
}

// UserMessageSignalPayload is the body of SignalUserMessage.
type UserMessageSignalPayload struct {
	TurnID  string `json:"turn_id"`
	UserID  string `json:"user_id"`
	Message string `json:"message"`
}

// ApprovalSignalPayload is the body of SignalApproval.
type ApprovalSignalPayload struct {
	ApprovalID string `json:"approval_id"`
	Approved   bool   `json:"approved"`
	ResolvedBy string `json:"resolved_by"`
	Notes      string `json:"notes"`
}

// AbortSignalPayload is the body of SignalAbort.
type AbortSignalPayload struct {
	RequestedBy string `json:"requested_by"`
	Reason      string `json:"reason"`
}
