package grpc

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/structpb"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// scaffolderActionsJSON is the v2 action registry's descriptors, generated from
// the worker's registry.
//
// The registry itself lives in temporal-workflows/internal/scaffolder, which
// this module cannot import, and importing the worker's action package would
// drag the Temporal SDK, git tooling and minio into a service that needs only a
// set of static JSON schemas. A drift test in temporal-workflows
// (TestScaffolderDescriptorsExport_MatchesCheckedInFile) fails when this file
// falls behind the registry. Regenerate with:
//
//	cd temporal-workflows && go run ./cmd/scaffolder-descriptors \
//	  > ../services/repository/internal/grpc/scaffolder_actions.json
//
//go:embed scaffolder_actions.json
var scaffolderActionsJSON []byte

// embeddedActionDescriptor mirrors one entry of the generated file.
type embeddedActionDescriptor struct {
	Name         string          `json:"name"`
	Family       string          `json:"family"`
	InputSchema  json.RawMessage `json:"inputSchema"`
	OutputSchema json.RawMessage `json:"outputSchema"`
	SupportsPlan bool            `json:"supportsPlan"`
}

var (
	scaffolderActionsOnce sync.Once
	scaffolderActions     []*templatev1.ActionDescriptor
	scaffolderActionsErr  error
)

// loadScaffolderActions decodes the embedded descriptors once. The file is
// generated already sorted by name, so the response order is stable.
func loadScaffolderActions() ([]*templatev1.ActionDescriptor, error) {
	scaffolderActionsOnce.Do(func() {
		var decoded []embeddedActionDescriptor
		if err := json.Unmarshal(scaffolderActionsJSON, &decoded); err != nil {
			scaffolderActionsErr = fmt.Errorf("decode embedded scaffolder actions: %w", err)
			return
		}
		out := make([]*templatev1.ActionDescriptor, 0, len(decoded))
		for _, d := range decoded {
			out = append(out, &templatev1.ActionDescriptor{
				Name:             d.Name,
				Family:           d.Family,
				InputSchemaJson:  string(d.InputSchema),
				OutputSchemaJson: string(d.OutputSchema),
				SupportsPlan:     d.SupportsPlan,
			})
		}
		scaffolderActions = out
	})
	return scaffolderActions, scaffolderActionsErr
}

// StartScaffolderRun starts a v2 ScaffolderWorkflow.
//
// The request carries only ids, so the stored definition is fetched here and
// passed into the workflow: workflow code never calls Payload, and history
// records exactly which document ran.
func (s *TemplateServer) StartScaffolderRun(ctx context.Context, req *connect.Request[templatev1.StartScaffolderRunRequest]) (*connect.Response[templatev1.StartScaffolderRunResponse], error) {
	msg := req.Msg

	if msg.GetRunId() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("run_id is required"))
	}
	// run_id becomes both the workflow id and the ActionRuns doc the worker
	// writes progress to, so it must at least be a well-formed doc id. Its
	// ownership is proven against the run itself further down.
	if !payloadDocIDPattern.MatchString(msg.GetRunId()) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("run_id must be a 24-character hex document id"))
	}
	if msg.GetDefinitionVersionId() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("definition_version_id is required"))
	}
	if msg.GetWorkspaceId() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workspace_id is required"))
	}
	// Close GO-H2: the request's workspace id must match the workspace the
	// verified caller identity is authorized for. Without this, the
	// version-vs-request comparison below proves nothing, since both sides
	// come from the same untrusted request.
	if err := svcauth.EnforceWorkspace(ctx, msg.GetWorkspaceId()); err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	if s.definitionClient == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("template definition client is not configured"))
	}
	if s.actionRunClient == nil {
		// Without the run reader there is no way to prove run_id belongs to
		// the caller, so refuse rather than dispatch a run we cannot vouch for.
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("action run client is not configured"))
	}
	if s.temporalClient == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("temporal is unavailable"))
	}
	scaffolderTemporal, ok := s.temporalClient.(ScaffolderTemporalClient)
	if !ok {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the configured temporal client cannot start scaffolder runs"))
	}

	// Prove the run before anything else is read: run_id is caller-supplied
	// and names the record the worker will write progress, outputs and logs
	// to. This is checked BEFORE the definition version so an unauthorized
	// caller cannot learn whether a version id exists.
	run, err := s.actionRunClient.GetActionRun(ctx, msg.GetRunId())
	if err != nil {
		switch {
		case errors.Is(err, ErrActionRunNotFound):
			return nil, connect.NewError(connect.CodeNotFound, err)
		case errors.Is(err, ErrIdentityRouteUnavailable):
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := checkRunMatchesRequest(run, msg); err != nil {
		return nil, err
	}

	version, err := s.definitionClient.GetDefinitionVersion(ctx, msg.GetDefinitionVersionId())
	if err != nil {
		switch {
		case errors.Is(err, ErrTemplateDefinitionVersionNotFound):
			return nil, connect.NewError(connect.CodeNotFound, err)
		case errors.Is(err, ErrIdentityRouteUnavailable):
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// A version belongs to exactly one workspace. Combined with the identity
	// check above (which pins workspace_id to the caller's own workspace),
	// this refuses to run another tenant's template.
	if version.WorkspaceID != "" && version.WorkspaceID != msg.GetWorkspaceId() {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("template definition version belongs to a different workspace"))
	}

	params := map[string]any{}
	if p := msg.GetParameters(); p != nil {
		params = p.AsMap()
	}

	// The run's own workspace and triggering user are the trustworthy source
	// for expression context: they come from the record, not the request.
	input := types.ScaffolderWorkflowInput{
		RunID:               msg.GetRunId(),
		DefinitionVersionID: msg.GetDefinitionVersionId(),
		DefinitionID:        version.DefinitionID,
		Definition:          version.DefinitionJSON,
		Parameters:          params,
		WorkspaceID:         run.Workspace.ID,
		WorkspaceSlug:       run.Workspace.Slug,
		WorkspaceName:       run.Workspace.Name,
		UserID:              msg.GetUserId(),
		DryRun:              msg.GetDryRun(),
	}
	if run.TriggeredBy != nil {
		// Prefer the record over the request: orbit-www set this server-side.
		// A disagreement is not fatal (the record still wins, so nothing
		// unsafe follows) but it means the caller is confused about whose run
		// this is, which is worth seeing in the logs.
		if requested := msg.GetUserId(); requested != "" && requested != run.TriggeredBy.ID {
			log.Printf("StartScaffolderRun: run %s was triggered by %s but the request said %s; using the run record",
				run.ID, run.TriggeredBy.ID, requested)
		}
		input.UserID = run.TriggeredBy.ID
		input.UserEmail = run.TriggeredBy.Email
		input.UserName = run.TriggeredBy.Name
	}

	workflowID, err := scaffolderTemporal.StartScaffolderWorkflow(ctx, input)
	if err != nil {
		if errors.Is(err, ErrScaffolderRunAlreadyDispatched) {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&templatev1.StartScaffolderRunResponse{WorkflowId: workflowID}), nil
}

// payloadDocIDPattern matches a Mongo ObjectId as Payload renders it.
var payloadDocIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{24}$`)

// ScaffolderRunIDPrefix is the workflow-id prefix StartScaffolderWorkflow
// assigns. Requiring it stops these handlers being used as a generic
// query/cancel surface over every workflow in the namespace.
const ScaffolderRunIDPrefix = "scaffolder-run-"

// authorizeScaffolderRun resolves the run's workspace from its memo and checks
// it against the caller's verified identity.
//
// GetRunProgress and CancelRun carry only a workflow id, so without this a
// caller could read another tenant's run outputs or cancel their run by
// guessing an id (which is derived from the ActionRuns doc id).
func (s *TemplateServer) authorizeScaffolderRun(ctx context.Context, workflowID string) (ScaffolderTemporalClient, error) {
	if workflowID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}
	if !strings.HasPrefix(workflowID, ScaffolderRunIDPrefix) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("workflow_id must be a scaffolder run (%s…)", ScaffolderRunIDPrefix))
	}
	if s.temporalClient == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("temporal is unavailable"))
	}
	scaffolderTemporal, ok := s.temporalClient.(ScaffolderTemporalClient)
	if !ok {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the configured temporal client cannot serve scaffolder runs"))
	}

	workspaceID, err := scaffolderTemporal.ScaffolderRunWorkspace(ctx, workflowID)
	if err != nil {
		if errors.Is(err, ErrScaffolderRunNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if workspaceID == "" {
		// A run started before the memo existed, or by something that did not
		// set it. Fail closed rather than serving an unscoped run.
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("scaffolder run has no workspace memo; refusing to serve it unscoped"))
	}
	if err := svcauth.EnforceWorkspace(ctx, workspaceID); err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	return scaffolderTemporal, nil
}

// runStartableStatuses are the run states a dispatch may act on. Anything else
// means the run has already been dispatched or resolved, and starting a
// workflow for it would overwrite a finished record.
var runStartableStatuses = map[string]bool{"pending": true, "running": true}

// checkRunMatchesRequest proves the request describes the run it names.
//
// Every field in the request is caller-supplied, so each is compared against
// the record: the workspace (which the caller is already authorized for),
// the template version, and the dry-run flag. A mismatch means the caller is
// either confused or trying to point a run record at different work.
func checkRunMatchesRequest(run *ActionRunData, msg *templatev1.StartScaffolderRunRequest) error {
	if run.Workspace.ID != msg.GetWorkspaceId() {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("action run belongs to a different workspace"))
	}
	if run.TemplateVersionID != msg.GetDefinitionVersionId() {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("action run is for template version %q, not %q",
				run.TemplateVersionID, msg.GetDefinitionVersionId()))
	}
	if run.DryRun != msg.GetDryRun() {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("action run dryRun is %t, request says %t", run.DryRun, msg.GetDryRun()))
	}
	if !runStartableStatuses[run.Status] {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("action run status %q cannot be dispatched", run.Status))
	}
	return nil
}

// GetRunProgress answers with the workflow's current per-step snapshot.
func (s *TemplateServer) GetRunProgress(ctx context.Context, req *connect.Request[templatev1.GetRunProgressRequest]) (*connect.Response[templatev1.GetRunProgressResponse], error) {
	workflowID := req.Msg.GetWorkflowId()
	scaffolderTemporal, err := s.authorizeScaffolderRun(ctx, workflowID)
	if err != nil {
		return nil, err
	}

	progress, err := scaffolderTemporal.QueryScaffolderProgress(ctx, workflowID)
	if err != nil {
		if errors.Is(err, ErrScaffolderRunNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &templatev1.GetRunProgressResponse{
		WorkflowId:   workflowID,
		Status:       parseWorkflowStatus(normalizeRunStatus(progress.Status)),
		ErrorMessage: progress.Error,
	}
	for _, step := range progress.Steps {
		resp.Steps = append(resp.Steps, &templatev1.StepProgress{
			Id:     step.ID,
			Name:   step.Name,
			Status: step.Status,
			Error:  step.Error,
		})
	}
	if len(progress.Outputs) > 0 {
		outputs, err := structpb.NewStruct(progress.Outputs)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("encode run outputs: %w", err))
		}
		resp.Outputs = outputs
	}

	return connect.NewResponse(resp), nil
}

// CancelRun cancels an in-progress scaffolder run.
func (s *TemplateServer) CancelRun(ctx context.Context, req *connect.Request[templatev1.CancelRunRequest]) (*connect.Response[templatev1.CancelRunResponse], error) {
	workflowID := req.Msg.GetWorkflowId()
	if _, err := s.authorizeScaffolderRun(ctx, workflowID); err != nil {
		return nil, err
	}

	if err := s.temporalClient.CancelWorkflow(ctx, workflowID); err != nil {
		if errors.Is(err, ErrScaffolderRunNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&templatev1.CancelRunResponse{Success: true}), nil
}

// ListActions returns the action registry's descriptors for the authoring UI
// and the TypeScript validator.
func (s *TemplateServer) ListActions(_ context.Context, _ *connect.Request[templatev1.ListActionsRequest]) (*connect.Response[templatev1.ListActionsResponse], error) {
	actions, err := loadScaffolderActions()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&templatev1.ListActionsResponse{Actions: actions}), nil
}

// normalizeRunStatus maps the scaffolder's "succeeded" onto the enum's
// "completed"; every other status already matches parseWorkflowStatus.
func normalizeRunStatus(status string) string {
	if status == "succeeded" {
		return "completed"
	}
	return status
}
