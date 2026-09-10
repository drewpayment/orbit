package grpc

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/structpb"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
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
	if msg.GetDefinitionVersionId() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("definition_version_id is required"))
	}
	if msg.GetWorkspaceId() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workspace_id is required"))
	}
	if s.definitionClient == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("template definition client is not configured"))
	}
	if s.temporalClient == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("temporal is unavailable"))
	}
	scaffolderTemporal, ok := s.temporalClient.(ScaffolderTemporalClient)
	if !ok {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the configured temporal client cannot start scaffolder runs"))
	}

	version, err := s.definitionClient.GetDefinitionVersion(ctx, msg.GetDefinitionVersionId())
	if err != nil {
		if errors.Is(err, ErrTemplateDefinitionVersionNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// A version belongs to exactly one workspace. Running it under a different
	// one would let a caller execute another tenant's template against their
	// own workspace, so refuse rather than trusting the request's workspace id.
	if version.WorkspaceID != "" && version.WorkspaceID != msg.GetWorkspaceId() {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("template definition version belongs to a different workspace"))
	}

	params := map[string]any{}
	if p := msg.GetParameters(); p != nil {
		params = p.AsMap()
	}

	workflowID, err := scaffolderTemporal.StartScaffolderWorkflow(ctx, types.ScaffolderWorkflowInput{
		RunID:               msg.GetRunId(),
		DefinitionVersionID: msg.GetDefinitionVersionId(),
		Definition:          version.DefinitionJSON,
		Parameters:          params,
		WorkspaceID:         msg.GetWorkspaceId(),
		UserID:              msg.GetUserId(),
		DryRun:              msg.GetDryRun(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&templatev1.StartScaffolderRunResponse{WorkflowId: workflowID}), nil
}

// GetRunProgress answers with the workflow's current per-step snapshot.
func (s *TemplateServer) GetRunProgress(ctx context.Context, req *connect.Request[templatev1.GetRunProgressRequest]) (*connect.Response[templatev1.GetRunProgressResponse], error) {
	workflowID := req.Msg.GetWorkflowId()
	if workflowID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}
	if s.temporalClient == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("temporal is unavailable"))
	}
	scaffolderTemporal, ok := s.temporalClient.(ScaffolderTemporalClient)
	if !ok {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the configured temporal client cannot query scaffolder runs"))
	}

	progress, err := scaffolderTemporal.QueryScaffolderProgress(ctx, workflowID)
	if err != nil {
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
	if workflowID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}
	if s.temporalClient == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("temporal is unavailable"))
	}

	if err := s.temporalClient.CancelWorkflow(ctx, workflowID); err != nil {
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
