package workflows

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

func TestToolOutputBuffer_CapsAndKeepsTail(t *testing.T) {
	b := &toolOutputBuffer{}
	// Write well past the cap in chunks.
	chunk := strings.Repeat("a", 10*1024)
	for i := 0; i < 10; i++ {
		b.append(chunk)
	}
	b.append("TAIL_MARKER")
	require.True(t, b.truncated, "expected truncation flag")
	require.LessOrEqual(t, len(b.data), toolOutputCap, "buffer must not exceed cap")
	require.True(t, strings.HasSuffix(string(b.data), "TAIL_MARKER"), "tail must be retained")
}

func TestToolOutputBuffer_UnderCapNotTruncated(t *testing.T) {
	b := &toolOutputBuffer{}
	b.append("short output")
	require.False(t, b.truncated)
	require.Equal(t, "short output", string(b.data))
}

// TestToolOutputAggregation_EmitsAggregatedEvent drives a shell_exec whose
// stub streams two output chunks to the workflow, then verifies exactly one
// aggregated tool_call_output event is persisted with the combined output.
func TestToolOutputAggregation_EmitsAggregatedEvent(t *testing.T) {
	suite := &testsuite.WorkflowTestSuite{}
	env := suite.NewTestWorkflowEnvironment()
	registerSandboxStubs(env)
	rec := &eventRecorder{}
	registerEventRecorder(env, rec)

	// SandboxedShell stub streams two chunks for callId "tc-shell" before
	// returning, simulating the real signiller's per-chunk signals.
	env.RegisterActivityWithOptions(
		func(_ context.Context, in agentactivity.SandboxedShellInput) (agentactivity.SandboxedShellResult, error) {
			env.SignalWorkflow(agentcontract.SignalToolOutput, agentcontract.ToolOutputSignalPayload{
				CallID: in.CallID, Stream: "stdout", Chunk: "hello ",
			})
			env.SignalWorkflow(agentcontract.SignalToolOutput, agentcontract.ToolOutputSignalPayload{
				CallID: in.CallID, Stream: "stdout", Chunk: "world",
			})
			return agentactivity.SandboxedShellResult{ExitCode: 0, Stdout: "hello world", DurationMs: 1}, nil
		},
		activity.RegisterOptions{Name: agentcontract.ActivitySandboxedShell},
	)

	llm := &scriptedLLM{
		steps: []agentactivity.LLMNextStepResult{
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-shell", Name: ToolShellExec, Arguments: map[string]any{"command": "echo hello world"}},
				},
				StopReason: "tool_use",
			},
			{
				ToolCalls: []providers.ToolCall{
					{ID: "tc-done", Name: ToolDone, Arguments: map[string]any{"summary": "ok"}},
				},
				StopReason: "tool_use",
			},
		},
	}
	env.RegisterActivityWithOptions(llm.Run, activity.RegisterOptions{Name: ActivityLLMNextStep})

	env.ExecuteWorkflow(InfrastructureAgentWorkflow, InfrastructureAgentInput{
		AgentRunID: "run-output", WorkspaceID: "ws-1", LLMProviderID: "p",
		InitialPrompt: "run echo",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var aggregated []agentactivity.AgentEventWire
	for _, e := range rec.allEvents() {
		if e.Kind == agentcontract.EventKindToolCallOutput {
			aggregated = append(aggregated, e)
		}
	}
	require.Len(t, aggregated, 1, "expected exactly one aggregated tool_call_output event")
	// Persisted payload is the camelCase DTO ({callId, stream, text}).
	require.Equal(t, "tc-shell", aggregated[0].Payload["callId"])
	require.Equal(t, "stdout", aggregated[0].Payload["stream"])
	require.Equal(t, "hello world", aggregated[0].Payload["text"])
}
