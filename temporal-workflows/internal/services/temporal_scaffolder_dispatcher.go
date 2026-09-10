package services

import (
	"context"
	"errors"
	"fmt"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// scaffolderRunIDPrefix mirrors services/repository/cmd/server/main.go's
// TemporalClient.StartScaffolderWorkflow, which cannot be imported here (the
// repository service depends on this module, not the other way around).
// Duplicated intentionally — see orbit-www/src/lib/actions/run.ts's
// SCAFFOLDER_RUN_ID_PREFIX constant for the same convention on the
// TypeScript side.
const scaffolderRunIDPrefix = "scaffolder-run-"

// scaffolderWorkspaceMemoKey mirrors services/repository/cmd/server/main.go's
// constant of the same name — the memo field GetRunProgress/CancelRun read
// to scope a workflow id to a tenant.
const scaffolderWorkspaceMemoKey = "workspaceId"

// scaffolderTaskQueue is the task queue every ScaffolderWorkflow dispatch
// uses, matching cmd/worker/main.go's worker.New(c, "orbit-workflows", ...).
const scaffolderTaskQueue = "orbit-workflows"

// ErrScaffolderRunAlreadyDispatched mirrors
// services/repository/internal/grpc.ErrScaffolderRunAlreadyDispatched
// (unexported/unreachable from this module) for the same "one ActionRun doc
// is dispatched exactly once, ever" duplicate-start case.
var ErrScaffolderRunAlreadyDispatched = errors.New("scaffolder run already dispatched")

// TemporalScaffolderDispatcher starts a ScaffolderWorkflow execution and
// returns immediately without awaiting it — the run/progress infrastructure
// the workflow itself writes back to (WriteRunProgress) is what a run page
// polls, so a caller here never needs to wait on completion. A thin wrapper
// over client.Client so activities.TemplateDryRunSweepActivities can depend
// on the small ScaffolderDispatcher interface instead of the full SDK
// client, matching TemplateDryRunSweepWorkflow's need in Phase 4 Task G to
// dispatch a run the same way StartScaffolderRun's gRPC handler does, but
// from inside the worker process itself.
type TemporalScaffolderDispatcher struct {
	client client.Client
}

func NewTemporalScaffolderDispatcher(c client.Client) *TemporalScaffolderDispatcher {
	return &TemporalScaffolderDispatcher{client: c}
}

// StartScaffolderWorkflow dispatches one ScaffolderWorkflow execution, id
// derived from runID exactly as the repository service's own dispatch path
// does, so a retried trigger of the same run reuses the id instead of
// starting a second workflow against one run record.
func (d *TemporalScaffolderDispatcher) StartScaffolderWorkflow(ctx context.Context, runID, workspaceID string, in types.ScaffolderWorkflowInput) (string, error) {
	if runID == "" {
		return "", errors.New("run id required")
	}
	workflowID := scaffolderRunIDPrefix + runID

	we, err := d.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: scaffolderTaskQueue,
		Memo: map[string]interface{}{
			scaffolderWorkspaceMemoKey: workspaceID,
		},
		WorkflowIDReusePolicy:                    enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}, types.ScaffolderWorkflowName, in)
	if err != nil {
		var alreadyStarted *serviceerror.WorkflowExecutionAlreadyStarted
		if errors.As(err, &alreadyStarted) {
			return "", ErrScaffolderRunAlreadyDispatched
		}
		return "", fmt.Errorf("failed to start scaffolder workflow: %w", err)
	}
	return we.GetID(), nil
}
