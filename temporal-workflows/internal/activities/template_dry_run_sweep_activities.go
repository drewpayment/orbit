package activities

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// Activity names for the scheduled re-dry-run sweep (Phase 4 Task G).
const (
	ActivityListPublishedTemplatesWithFixtures = "ListPublishedTemplatesWithFixtures"
	ActivityTriggerTemplateDryRun              = "TriggerTemplateDryRun"
)

// SweepPayloadClient is the subset of PayloadTemplateSweepClient the sweep
// activities need. Satisfied by *services.PayloadTemplateSweepClient;
// an interface here keeps the activities testable without an HTTP server.
type SweepPayloadClient interface {
	ListDryRunSweepCandidates(ctx context.Context) ([]services.DryRunSweepCandidate, error)
	TriggerDryRun(ctx context.Context, definitionID string, in services.TriggerDryRunInput) (*services.TriggerDryRunResult, error)
	WriteDryRunSweepResult(ctx context.Context, definitionID string, in services.DryRunSweepResultInput) (*services.DryRunSweepResultResponse, error)
}

// ScaffolderDispatcher starts a ScaffolderWorkflow execution and returns
// immediately without awaiting it. Satisfied by
// *services.TemporalScaffolderDispatcher; an interface here keeps
// TriggerTemplateDryRun testable without a real Temporal client.
type ScaffolderDispatcher interface {
	StartScaffolderWorkflow(ctx context.Context, runID, workspaceID string, in types.ScaffolderWorkflowInput) (string, error)
}

// SweepFixture mirrors one fixture the sweep will dry-run.
type SweepFixture struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Values map[string]any `json:"values"`
}

// SweepTemplateCandidate is one published template-definition the sweep
// considers. Fixtures may be empty — TemplateDryRunSweepWorkflow logs those
// rather than silently skipping them.
type SweepTemplateCandidate struct {
	DefinitionID     string         `json:"definitionId"`
	Name             string         `json:"name"`
	WorkspaceID      string         `json:"workspaceId"`
	CurrentVersionID string         `json:"currentVersionId"`
	Fixtures         []SweepFixture `json:"fixtures"`
}

// ListPublishedTemplatesWithFixturesResult is ListPublishedTemplatesWithFixtures's result.
type ListPublishedTemplatesWithFixturesResult struct {
	Templates []SweepTemplateCandidate `json:"templates"`
}

// TriggerTemplateDryRunInput is TriggerTemplateDryRun's input: one fixture of
// one published template-definition.
type TriggerTemplateDryRunInput struct {
	DefinitionID     string         `json:"definitionId"`
	DefinitionName   string         `json:"definitionName,omitempty"`
	CurrentVersionID string         `json:"currentVersionId"`
	WorkspaceID      string         `json:"workspaceId"`
	FixtureID        string         `json:"fixtureId,omitempty"`
	FixtureName      string         `json:"fixtureName,omitempty"`
	Parameters       map[string]any `json:"parameters"`
}

// TriggerTemplateDryRunResult is TriggerTemplateDryRun's result.
type TriggerTemplateDryRunResult struct {
	RunID      string `json:"runId"`
	WorkflowID string `json:"workflowId"`
}

// RecordSweepResultInput is RecordSweepResult's input, called from
// ScaffolderWorkflow.finish() only when DryRun && Trigger ==
// "scheduled-sweep". PlanHash is a stable content hash of the run's
// PlannedChange[], computed in workflow code (see
// workflows.computePlanHash) so this activity stays a dumb HTTP writer.
type RecordSweepResultInput struct {
	DefinitionID string `json:"definitionId"`
	Failed       bool   `json:"failed"`
	PlanHash     string `json:"planHash"`
}

// TemplateDryRunSweepActivities implements the scheduled re-dry-run sweep's
// activities (Phase 4 Task G): listing sweep-eligible definitions,
// creating+dispatching one dry run per fixture, and recording the drift
// outcome from ScaffolderWorkflow's finish().
type TemplateDryRunSweepActivities struct {
	client     SweepPayloadClient
	dispatcher ScaffolderDispatcher
	logger     *slog.Logger
}

// NewTemplateDryRunSweepActivities wires the sweep activities. dispatcher may
// be nil for a caller that only needs ListPublishedTemplatesWithFixtures or
// RecordSweepResult (neither dispatches a workflow).
func NewTemplateDryRunSweepActivities(client SweepPayloadClient, dispatcher ScaffolderDispatcher, logger *slog.Logger) *TemplateDryRunSweepActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemplateDryRunSweepActivities{client: client, dispatcher: dispatcher, logger: logger}
}

// ListPublishedTemplatesWithFixtures lists every published
// template-definition eligible for the sweep. A failure here is always
// transient (an HTTP/network error talking to orbit-www) and stays
// retryable.
func (a *TemplateDryRunSweepActivities) ListPublishedTemplatesWithFixtures(ctx context.Context) (*ListPublishedTemplatesWithFixturesResult, error) {
	candidates, err := a.client.ListDryRunSweepCandidates(ctx)
	if err != nil {
		return nil, fmt.Errorf("list dry-run sweep candidates: %w", err)
	}

	templates := make([]SweepTemplateCandidate, 0, len(candidates))
	for _, c := range candidates {
		fixtures := make([]SweepFixture, 0, len(c.Fixtures))
		for _, f := range c.Fixtures {
			fixtures = append(fixtures, SweepFixture{ID: f.ID, Name: f.Name, Values: f.Values})
		}
		templates = append(templates, SweepTemplateCandidate{
			DefinitionID:     c.DefinitionID,
			Name:             c.Name,
			WorkspaceID:      c.WorkspaceID,
			CurrentVersionID: c.CurrentVersionID,
			Fixtures:         fixtures,
		})
	}
	return &ListPublishedTemplatesWithFixturesResult{Templates: templates}, nil
}

// TriggerTemplateDryRun creates a dryRun:true action-run for one fixture and
// dispatches ScaffolderWorkflow with Trigger: "scheduled-sweep", without
// awaiting it — the run/progress infrastructure ScaffolderWorkflow itself
// writes back to is what the run page polls.
//
// A malformed input (missing definition/version id) and a definition that no
// longer resolves are non-retryable: no retry fixes either. A transient
// failure creating the run, or dispatching the workflow, stays retryable.
func (a *TemplateDryRunSweepActivities) TriggerTemplateDryRun(ctx context.Context, in TriggerTemplateDryRunInput) (*TriggerTemplateDryRunResult, error) {
	if in.DefinitionID == "" || in.CurrentVersionID == "" {
		return nil, nonRetryable(errors.New("trigger template dry run: definitionId and currentVersionId are required"))
	}

	triggered, err := a.client.TriggerDryRun(ctx, in.DefinitionID, services.TriggerDryRunInput{
		TemplateVersionID: in.CurrentVersionID,
		Parameters:        in.Parameters,
		Trigger:           "scheduled-sweep",
	})
	if err != nil {
		if errors.Is(err, services.ErrTemplateDefinitionNotFound) {
			return nil, nonRetryable(fmt.Errorf("trigger template dry run %q: %w", in.DefinitionID, err))
		}
		return nil, fmt.Errorf("trigger template dry run %q: %w", in.DefinitionID, err)
	}

	workflowID, err := a.dispatcher.StartScaffolderWorkflow(ctx, triggered.RunID, triggered.WorkspaceID, types.ScaffolderWorkflowInput{
		RunID:               triggered.RunID,
		DefinitionVersionID: in.CurrentVersionID,
		DefinitionID:        in.DefinitionID,
		Definition:          triggered.DefinitionJSON,
		Parameters:          in.Parameters,
		WorkspaceID:         triggered.WorkspaceID,
		DryRun:              true,
		Trigger:             "scheduled-sweep",
	})
	if err != nil {
		// The action-run row was already created and IS the audit trail of a
		// triggered-but-undispatched dry run; not rolled back here (matches
		// StartScaffolderRun's gRPC handler, which has the same gap for a
		// human-triggered run whose dispatch fails after creation).
		return nil, fmt.Errorf("start scaffolder workflow for run %q: %w", triggered.RunID, err)
	}

	a.logger.Info("Triggered scheduled-sweep dry run",
		"definitionId", in.DefinitionID, "fixtureId", in.FixtureID, "runId", triggered.RunID, "workflowId", workflowID)

	return &TriggerTemplateDryRunResult{RunID: triggered.RunID, WorkflowID: workflowID}, nil
}

// RecordSweepResult writes a sweep-triggered dry run's drift outcome back to
// its template-definitions doc. Called from ScaffolderWorkflow.finish() ONLY
// when DryRun && Trigger == "scheduled-sweep" — never for a human "Preview".
func (a *TemplateDryRunSweepActivities) RecordSweepResult(ctx context.Context, in RecordSweepResultInput) error {
	if in.DefinitionID == "" {
		return nonRetryable(errors.New("record sweep result: definitionId is required"))
	}

	_, err := a.client.WriteDryRunSweepResult(ctx, in.DefinitionID, services.DryRunSweepResultInput{
		Failed:   in.Failed,
		PlanHash: in.PlanHash,
	})
	if err != nil {
		if errors.Is(err, services.ErrTemplateDefinitionNotFound) {
			return nonRetryable(fmt.Errorf("record sweep result %q: %w", in.DefinitionID, err))
		}
		return fmt.Errorf("record sweep result %q: %w", in.DefinitionID, err)
	}
	return nil
}
