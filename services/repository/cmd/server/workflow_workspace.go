package main

import (
	"context"
	"fmt"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/converter"

	grpcserver "github.com/drewpayment/orbit/services/repository/internal/grpc"
)

var _ grpcserver.WorkflowWorkspaceResolver = (*TemporalClient)(nil)

// workspaceMemo is the memo every workflow started by this service carries, so
// the object-addressed launch/deployment/build/template RPCs can scope
// themselves to a tenant from the workflow alone (see WorkflowWorkspace).
func workspaceMemo(workspaceID string) map[string]interface{} {
	return map[string]interface{}{scaffolderWorkspaceMemoKey: workspaceID}
}

// WorkflowWorkspace reports the workspace a workflow was started for. It
// implements grpcserver.WorkflowWorkspaceResolver.
//
// The memo is authoritative and cheap (DescribeWorkflowExecution also answers
// for closed workflows). Workflows started before the memo existed fall back to
// the workspaceId in their start input, which every one of these workflow input
// types carries. A workflow with neither yields "" — callers treat that as
// "owner unknown" and admit only a platform admin.
func (tc *TemporalClient) WorkflowWorkspace(ctx context.Context, workflowID string) (string, error) {
	desc, err := tc.client.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		if isTemporalNotFound(err) {
			return "", grpcserver.ErrWorkflowNotFound
		}
		return "", fmt.Errorf("failed to describe workflow: %w", err)
	}

	if info := desc.GetWorkflowExecutionInfo(); info != nil && info.GetMemo() != nil {
		if payload, ok := info.GetMemo().GetFields()[scaffolderWorkspaceMemoKey]; ok {
			var workspaceID string
			if err := converter.GetDefaultDataConverter().FromPayload(payload, &workspaceID); err != nil {
				return "", fmt.Errorf("failed to decode workflow workspace memo: %w", err)
			}
			return workspaceID, nil
		}
	}

	return tc.workspaceFromStartInput(ctx, workflowID)
}

// workspaceFromStartInput reads workspaceId from the workflow's first history
// event (WorkflowExecutionStarted), the fallback for workflows with no memo.
func (tc *TemporalClient) workspaceFromStartInput(ctx context.Context, workflowID string) (string, error) {
	iter := tc.client.GetWorkflowHistory(ctx, workflowID, "", false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	if !iter.HasNext() {
		return "", nil
	}
	event, err := iter.Next()
	if err != nil {
		if isTemporalNotFound(err) {
			return "", grpcserver.ErrWorkflowNotFound
		}
		return "", fmt.Errorf("failed to read workflow history: %w", err)
	}
	started := event.GetWorkflowExecutionStartedEventAttributes()
	if started == nil || started.GetInput() == nil {
		return "", nil
	}

	var input struct {
		WorkspaceID string `json:"workspaceId"`
	}
	if err := converter.GetDefaultDataConverter().FromPayloads(started.GetInput(), &input); err != nil {
		// An input that is not a workspace-bearing struct has no recorded owner.
		return "", nil
	}
	return input.WorkspaceID, nil
}
