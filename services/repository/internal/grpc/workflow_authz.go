package grpc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	"github.com/drewpayment/orbit/proto/pkg/svcauth"
)

// WorkflowWorkspaceResolver is implemented by Temporal clients that can report
// which workspace a workflow belongs to.
//
// The launch, deployment, build and legacy template-instantiation RPCs that
// operate on an existing workflow carry only a workflow id, so the tenant
// boundary cannot be checked from the request. The owning workspace is read
// from the workflow itself (its memo, or its start input for workflows started
// before the memo existed) — never from anything the caller sent.
type WorkflowWorkspaceResolver interface {
	// WorkflowWorkspace returns the workspace the workflow was started for, or
	// "" when it cannot be determined. It returns ErrWorkflowNotFound for an
	// unknown or expired workflow.
	WorkflowWorkspace(ctx context.Context, workflowID string) (string, error)
}

// ErrWorkflowNotFound is returned by a WorkflowWorkspaceResolver when the
// workflow id does not resolve, so handlers can answer NotFound.
var ErrWorkflowNotFound = errors.New("workflow not found")

// Workflow-id prefixes assigned by the repository service's Temporal client.
// Requiring the expected prefix stops these RPCs being used as a generic
// query/signal/cancel surface over every workflow in the namespace.
const (
	launchWorkflowIDPrefix     = "launch-"
	deploymentWorkflowIDPrefix = "deployment-"
	buildWorkflowIDPrefix      = "build-"
	templateWorkflowIDPrefix   = "template-instantiation-"
)

// authorizeWorkflow proves the caller may act on an existing workflow: the id
// must carry the expected prefix, and the workflow's owning workspace (resolved
// server-side) must equal the caller's authorized workspace. A platform admin
// may act on any workspace's workflows; a workflow whose owner cannot be
// determined is admin-only (fail closed).
func authorizeWorkflow(ctx context.Context, temporal any, workflowID, prefix string) error {
	if workflowID == "" {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}
	if !strings.HasPrefix(workflowID, prefix) {
		return connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("workflow_id must start with %q", prefix))
	}
	resolver, ok := temporal.(WorkflowWorkspaceResolver)
	if !ok || resolver == nil {
		return connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the configured temporal client cannot resolve a workflow's workspace"))
	}

	workspaceID, err := resolver.WorkflowWorkspace(ctx, workflowID)
	if err != nil {
		if errors.Is(err, ErrWorkflowNotFound) {
			return connect.NewError(connect.CodeNotFound, err)
		}
		return connect.NewError(connect.CodeInternal, err)
	}
	if err := svcauth.EnforceWorkspaceOrPlatformAdmin(ctx, workspaceID); err != nil {
		return connect.NewError(connect.CodePermissionDenied, err)
	}
	return nil
}

// enforceBodyWorkspace checks a request's own workspace_id against the
// verified caller identity, mapping the result to a Connect error.
func enforceBodyWorkspace(ctx context.Context, workspaceID string) error {
	if err := svcauth.EnforceWorkspace(ctx, workspaceID); err != nil {
		return connect.NewError(connect.CodePermissionDenied, err)
	}
	return nil
}

// enforceCallerWorkspace is for RPCs that name no workspace and none can be
// resolved server-side (DeployToLaunch addresses a launch by id, and the
// launch's owning workspace lives only in orbit-www's database). It requires
// the token to carry a workspace claim — which orbit-www signs only after
// verifying the user's membership of the launch's workspace — or the platform
// admin claim, so a token minted without any workspace scope cannot reach it.
func enforceCallerWorkspace(ctx context.Context) error {
	id, ok := svcauth.IdentityFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodePermissionDenied, errors.New("no verified identity in context"))
	}
	return enforceBodyWorkspace(ctx, id.WorkspaceID)
}
