// Package providers defines the LLM provider abstraction the infrastructure
// agent uses to drive its conversation loop. Concrete implementations live in
// subpackages (anthropic, openai_compat) and self-register via init().
package providers

import "context"

// Role identifies the speaker of a Message.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message is one turn in the conversation history fed to the LLM.
type Message struct {
	Role    Role
	Content string

	// ToolCallID and Name are set on Role=="tool" messages to associate the
	// result with a prior assistant tool-use call.
	ToolCallID string
	Name       string

	// ToolCalls are set on Role=="assistant" turns where the model decided to
	// invoke one or more tools. When ToolCalls is non-empty Content is usually
	// empty.
	ToolCalls []ToolCall
}

// ToolCall is one tool invocation requested by the assistant.
type ToolCall struct {
	ID        string
	Name      string
	Arguments map[string]any
}

// ToolSchema is the shape exposed to the model. InputSchema is JSON Schema.
type ToolSchema struct {
	Name        string
	Description string
	InputSchema map[string]any
}

// CompletionRequest is the provider-agnostic request body.
type CompletionRequest struct {
	Model       string
	System      string
	Messages    []Message
	Tools       []ToolSchema
	Temperature float64
	MaxTokens   int
}

// DeltaKind classifies streamed updates from the provider.
type DeltaKind string

const (
	DeltaText          DeltaKind = "text"
	DeltaToolCallStart DeltaKind = "tool_call_start"
	DeltaToolCallArgs  DeltaKind = "tool_call_args"
	DeltaToolCallEnd   DeltaKind = "tool_call_end"
	DeltaStop          DeltaKind = "stop"
)

// Delta is one streamed update from the provider. Activities use these to
// signal the parent workflow with token-level progress.
type Delta struct {
	Kind        DeltaKind
	Text        string
	ToolID      string
	ToolName    string
	PartialJSON string
	StopReason  string
}

// Response is the final assembled output once streaming completes.
type Response struct {
	StopReason string
	Text       string
	ToolCalls  []ToolCall
	Usage      Usage
}

// Usage tallies token consumption for accounting.
type Usage struct {
	InputTokens  int
	OutputTokens int
}

// Config is the runtime configuration for a single provider instance.
type Config struct {
	APIKey  string
	BaseURL string
	Model   string
}

// Provider is the interface every backend implements.
type Provider interface {
	Name() string
	// StreamComplete runs one completion. onDelta is invoked synchronously as
	// streamed updates arrive; if it returns an error the stream is aborted.
	StreamComplete(ctx context.Context, req CompletionRequest, onDelta func(Delta) error) (Response, error)
}

// Factory builds a Provider from a Config. Implementations register a Factory
// in init() against a stable name (e.g. "anthropic", "openai_compat").
type Factory func(cfg Config) (Provider, error)
