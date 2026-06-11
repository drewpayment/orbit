package workflows

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// The persisted payload must be the camelCase per-kind DTO the read-path
// mapper consumes — NOT the workflow's internal snake_case event payload.
// These tests pin the transform for every durable kind.

func TestToDurableDTO_ConversationTurn(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindConversationTurn, map[string]any{
		"turn_id":      "t-1",
		"role":         "assistant",
		"content":      "hello",
		"tool_name":    "shell_exec",
		"tool_call_id": "tc-1",
		"tool_calls":   []any{}, // internal-only; must be dropped
	})
	require.Equal(t, "t-1", out["turnId"])
	require.Equal(t, "assistant", out["role"])
	require.Equal(t, "hello", out["content"])
	require.Equal(t, "shell_exec", out["toolName"])
	require.Equal(t, "tc-1", out["toolCallId"])
	assertNoSnakeKeys(t, out)
	_, hasToolCalls := out["toolCalls"]
	require.False(t, hasToolCalls, "internal tool_calls must not be persisted")
}

func TestToDurableDTO_ConversationTurn_OmitsEmptyOptionals(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindConversationTurn, map[string]any{
		"turn_id": "t-1", "role": "user", "content": "hi",
		"tool_name": "", "tool_call_id": "",
	})
	_, hasName := out["toolName"]
	_, hasCallID := out["toolCallId"]
	require.False(t, hasName, "empty toolName should be omitted")
	require.False(t, hasCallID, "empty toolCallId should be omitted")
}

func TestToDurableDTO_ProposalUpdate(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindProposalUpdate, map[string]any{
		"proposal_id": "p-1", "title": "T", "summary": "S", "body_markdown": "B",
	})
	require.Equal(t, "p-1", out["proposalId"])
	require.Equal(t, "T", out["title"])
	require.Equal(t, "S", out["summary"])
	require.Equal(t, "B", out["bodyMarkdown"])
	assertNoSnakeKeys(t, out)
}

func TestToDurableDTO_ApprovalRequest_FullToolRegistration(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindApprovalRequest, map[string]any{
		"approval_id":       "a-1",
		"kind":              "tool_registration",
		"title":             "Register",
		"body_markdown":     "body",
		"agent_tool_id":     "row-1",
		"name":              "deploy",
		"description":       "do it",
		"template_kind":     "shell",
		"template_json":     `{"command":"x"}`,
		"input_schema_json": `{"type":"object"}`,
		"reasoning":         "useful",
	})
	require.Equal(t, "a-1", out["approvalId"])
	require.Equal(t, "tool_registration", out["kind"])
	require.Equal(t, "Register", out["title"])
	require.Equal(t, "body", out["bodyMarkdown"])
	require.Equal(t, "row-1", out["agentToolId"])
	require.Equal(t, "deploy", out["name"])
	require.Equal(t, "do it", out["description"])
	require.Equal(t, "shell", out["templateKind"])
	require.Equal(t, `{"command":"x"}`, out["templateJson"])
	require.Equal(t, `{"type":"object"}`, out["inputSchemaJson"])
	require.Equal(t, "useful", out["reasoning"])
	assertNoSnakeKeys(t, out)
}

func TestToDurableDTO_ApprovalRequest_PatternHoistsDisplayNameCategoryPatternId(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindApprovalRequest, map[string]any{
		"approval_id":  "a-2",
		"kind":         "pattern_registration",
		"title":        "Register pattern",
		"pattern_id":   "pat-1",
		"display_name": "Nice Name",
		"category":     "deploy",
		"name":         "p",
	})
	require.Equal(t, "pat-1", out["patternId"])
	require.Equal(t, "Nice Name", out["displayName"])
	require.Equal(t, "deploy", out["category"])
	assertNoSnakeKeys(t, out)
}

func TestToDurableDTO_ApprovalResolution(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindApprovalResolved, map[string]any{
		"approval_id": "a-1", "approved": true, "resolved_by": "u-1", "notes": "ok",
		// internal-only extras the DTO doesn't carry:
		"edited_fields": []string{"x"}, "agent_tool_version_id": "v-2",
	})
	require.Equal(t, "a-1", out["approvalId"])
	require.Equal(t, true, out["approved"])
	require.Equal(t, "u-1", out["resolvedBy"])
	require.Equal(t, "ok", out["notes"])
	assertNoSnakeKeys(t, out)
}

func TestToDurableDTO_StatusUpdate(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindStatusUpdate, map[string]any{
		"status": "completed", "message": "done",
	})
	require.Equal(t, "completed", out["status"])
	require.Equal(t, "done", out["message"])
	assertNoSnakeKeys(t, out)
}

func TestToDurableDTO_ToolCallOutput(t *testing.T) {
	out := toDurableDTO(agentcontract.EventKindToolCallOutput, map[string]any{
		"call_id": "tc-1", "stream": "stdout", "output": "hello world", "truncated": false,
	})
	require.Equal(t, "tc-1", out["callId"])
	require.Equal(t, "stdout", out["stream"])
	require.Equal(t, "hello world", out["text"])
	assertNoSnakeKeys(t, out)
}

// assertNoSnakeKeys fails if any payload key contains an underscore, catching
// leaked internal snake_case keys.
func assertNoSnakeKeys(t *testing.T, m map[string]any) {
	t.Helper()
	for k := range m {
		require.NotContains(t, k, "_", "payload key %q must be camelCase, not snake_case", k)
	}
}
