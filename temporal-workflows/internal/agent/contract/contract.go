// Package contract holds the wire constants and payload types shared between
// the InfrastructureAgentWorkflow, the agent activities, the gRPC server, and
// the temporal-side helper services. Keeping these in their own package
// breaks an import cycle (services -> workflows -> activities -> services)
// while ensuring all sides agree on signal names, query names, and payload
// shapes.
package contract

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
