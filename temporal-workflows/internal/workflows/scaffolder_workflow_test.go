package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// scaffolderStubs collects what the stub activities saw, so each test can
// assert on the dispatch sequence and the progress writebacks.
type scaffolderStubs struct {
	executed  []activities.ScaffolderStepInput
	planned   []activities.ScaffolderStepInput
	progress  []activities.WriteRunProgressInput
	cleanups  []activities.CleanupScaffolderRunInput
	validated []activities.ValidateDefinitionInput

	// configurable behaviour
	validationErrors []string
	executeFn        func(in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error)
	planFn           func(in activities.ScaffolderStepInput) (*activities.ScaffolderPlanResult, error)
	progressErr      error
}

type ScaffolderWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env   *testsuite.TestWorkflowEnvironment
	stubs *scaffolderStubs
}

func (s *ScaffolderWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
	s.stubs = &scaffolderStubs{}
	stubs := s.stubs

	s.env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.ValidateDefinitionInput) (*activities.ValidateDefinitionResult, error) {
			stubs.validated = append(stubs.validated, in)
			return &activities.ValidateDefinitionResult{Errors: stubs.validationErrors}, nil
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderValidateDefinition},
	)

	s.env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
			stubs.executed = append(stubs.executed, in)
			if stubs.executeFn != nil {
				return stubs.executeFn(in)
			}
			return &activities.ScaffolderStepResult{
				Output: map[string]any{"ok": true, "repoUrl": "https://example.com/" + in.StepID},
			}, nil
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderExecuteStep},
	)

	s.env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.ScaffolderStepInput) (*activities.ScaffolderPlanResult, error) {
			stubs.planned = append(stubs.planned, in)
			if stubs.planFn != nil {
				return stubs.planFn(in)
			}
			return &activities.ScaffolderPlanResult{
				Changes: []scaffolder.PlannedChange{{Kind: "log", Name: in.StepID}},
			}, nil
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderPlanStep},
	)

	s.env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.WriteRunProgressInput) error {
			stubs.progress = append(stubs.progress, in)
			return stubs.progressErr
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderWriteRunProgress},
	)

	s.env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.CleanupScaffolderRunInput) error {
			stubs.cleanups = append(stubs.cleanups, in)
			return nil
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderCleanupRun},
	)
}

func (s *ScaffolderWorkflowTestSuite) AfterTest(_, _ string) {
	s.env.AssertExpectations(s.T())
}

// --- helpers ----------------------------------------------------------------

func twoStepDefinition() scaffolder.Definition {
	return scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata: scaffolder.Metadata{
			Name: "svc", Title: "Service", Owner: "platform", TargetKind: "service",
		},
		Spec: scaffolder.Spec{
			Steps: []scaffolder.Step{
				{ID: "create", Name: "Create repo", Action: "github:repo:create", Input: json.RawMessage(`{"name":"${{ parameters.name }}"}`)},
				{ID: "log", Name: "Log it", Action: "debug:log", Input: json.RawMessage(`{"message":"made ${{ steps.create.output.repoUrl }}"}`)},
			},
			Output: &scaffolder.Output{
				Text:  "created ${{ steps.create.output.repoUrl }}",
				Links: []scaffolder.OutputLink{{Title: "Repo", URL: "${{ steps.create.output.repoUrl }}"}},
			},
		},
	}
}

func baseInput(def scaffolder.Definition) ScaffolderWorkflowInput {
	return ScaffolderWorkflowInput{
		RunID:               "run-1",
		DefinitionVersionID: "ver-1",
		Definition:          def,
		Parameters:          map[string]any{"name": "orders"},
		WorkspaceID:         "ws-1",
		UserID:              "user-1",
	}
}

func (s *ScaffolderWorkflowTestSuite) result() *ScaffolderWorkflowResult {
	s.Require().True(s.env.IsWorkflowCompleted())
	s.Require().NoError(s.env.GetWorkflowError())
	var res *ScaffolderWorkflowResult
	s.Require().NoError(s.env.GetWorkflowResult(&res))
	return res
}

// lastProgress returns the terminal writeback, which the run record ends on.
func (s *ScaffolderWorkflowTestSuite) lastProgress() activities.WriteRunProgressInput {
	s.Require().NotEmpty(s.stubs.progress)
	return s.stubs.progress[len(s.stubs.progress)-1]
}

func stepByID(steps []activities.ScaffolderStepProgress, id string) (activities.ScaffolderStepProgress, bool) {
	for _, st := range steps {
		if st.ID == id {
			return st, true
		}
	}
	return activities.ScaffolderStepProgress{}, false
}

// --- happy path -------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestSucceeds_ResolvesExpressionsAndOutputs() {
	s.stubs.executeFn = func(in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
		if in.StepID == "create" {
			return &activities.ScaffolderStepResult{Output: map[string]any{"repoUrl": "https://example.com/orders"}}, nil
		}
		return &activities.ScaffolderStepResult{Output: map[string]any{}}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(res.Error)

	// Parameters and prior step outputs are resolved before dispatch.
	s.Require().Len(s.stubs.executed, 2)
	s.JSONEq(`{"name":"orders"}`, string(s.stubs.executed[0].Input))
	s.JSONEq(`{"message":"made https://example.com/orders"}`, string(s.stubs.executed[1].Input))
	s.False(s.stubs.executed[0].DryRun)
	s.Equal("ws-1", s.stubs.executed[0].WorkspaceID)
	s.Equal("ver-1", s.stubs.executed[0].TemplateVersionID)

	// spec.output resolves against the final context.
	s.Equal("created https://example.com/orders", res.Outputs["text"])
	links, ok := res.Outputs["links"].([]any)
	s.Require().True(ok)
	s.Require().Len(links, 1)
	s.Equal("https://example.com/orders", links[0].(map[string]any)["url"])

	// Progress is written after every step plus the terminal write.
	s.GreaterOrEqual(len(s.stubs.progress), 3)
	last := s.lastProgress()
	s.Equal("succeeded", last.Status)
	s.False(last.HasPlan, "a live run must not clobber a stored plan")
	create, ok := stepByID(last.Steps, "create")
	s.Require().True(ok)
	s.Equal("succeeded", create.Status)
	s.Equal("https://example.com/orders", create.Output["repoUrl"])

	s.Require().Len(s.stubs.cleanups, 1)
	s.Equal("run-1", s.stubs.cleanups[0].RunID)
	s.Len(s.stubs.planned, 0)
}

func (s *ScaffolderWorkflowTestSuite) TestValidatesBeforeDispatchingAnyStep() {
	s.stubs.validationErrors = []string{`spec.steps[0].action: unknown action "github:repo:create"`}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "unknown action")
	s.Len(s.stubs.validated, 1)
	s.Empty(s.stubs.executed, "no step may run against an invalid definition")
	s.Equal("failed", s.lastProgress().Status)
	s.Require().Len(s.stubs.cleanups, 1, "the work dir must be cleaned up even when nothing ran")
}

// --- conditions -------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestSkipsStepWhenIfIsFalse() {
	def := twoStepDefinition()
	def.Spec.Steps[1].If = "${{ parameters.wantLog }}"
	in := baseInput(def)
	in.Parameters["wantLog"] = false

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.executed, 1)
	s.Equal("create", s.stubs.executed[0].StepID)

	logStep, ok := stepByID(s.lastProgress().Steps, "log")
	s.Require().True(ok)
	s.Equal("skipped", logStep.Status)
}

func (s *ScaffolderWorkflowTestSuite) TestRunsStepWhenIfIsTrue() {
	def := twoStepDefinition()
	def.Spec.Steps[1].If = "${{ parameters.wantLog }}"
	in := baseInput(def)
	in.Parameters["wantLog"] = true

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)
	s.Len(s.stubs.executed, 2)
}

func (s *ScaffolderWorkflowTestSuite) TestBadConditionFailsWithoutDispatching() {
	def := twoStepDefinition()
	def.Spec.Steps[0].If = "${{ parameters.missing }}"

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "create")
	s.Empty(s.stubs.executed, "an unresolvable condition must not schedule an activity")
	s.Require().Len(s.stubs.cleanups, 1)
}

func (s *ScaffolderWorkflowTestSuite) TestUnresolvableInputFailsWithoutDispatching() {
	def := twoStepDefinition()
	def.Spec.Steps[0].Input = json.RawMessage(`{"name":"${{ parameters.nope }}"}`)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Empty(s.stubs.executed)
	failed, ok := stepByID(s.lastProgress().Steps, "create")
	s.Require().True(ok)
	s.Equal("failed", failed.Status)
}

// --- failures ---------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestStepFailureStopsTheRun() {
	s.stubs.executeFn = func(in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
		if in.StepID == "create" {
			return nil, temporal.NewNonRetryableApplicationError("github said no", activities.ErrTypeScaffolderInvalid, nil)
		}
		return &activities.ScaffolderStepResult{}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "github said no")
	s.Len(s.stubs.executed, 1, "the second step must not run after the first fails")

	last := s.lastProgress()
	s.Equal("failed", last.Status)
	create, _ := stepByID(last.Steps, "create")
	s.Equal("failed", create.Status)
	s.Contains(create.Error, "github said no")
	logStep, _ := stepByID(last.Steps, "log")
	s.Equal("pending", logStep.Status)

	s.Require().Len(s.stubs.cleanups, 1, "the work dir must be cleaned up on failure")
}

func (s *ScaffolderWorkflowTestSuite) TestContinueOnErrorKeepsGoing() {
	def := twoStepDefinition()
	def.Spec.Steps[0].ContinueOnError = true
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"static"}`)
	def.Spec.Output = nil

	s.stubs.executeFn = func(in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
		if in.StepID == "create" {
			return nil, temporal.NewNonRetryableApplicationError("transient-ish", activities.ErrTypeScaffolderInvalid, nil)
		}
		return &activities.ScaffolderStepResult{Output: map[string]any{}}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Len(s.stubs.executed, 2)
	create, _ := stepByID(s.lastProgress().Steps, "create")
	s.Equal("failed", create.Status)
}

func (s *ScaffolderWorkflowTestSuite) TestFailedStepOutputIsNotReferenceable() {
	def := twoStepDefinition()
	def.Spec.Steps[0].ContinueOnError = true
	def.Spec.Output = nil

	s.stubs.executeFn = func(in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
		if in.StepID == "create" {
			return nil, errors.New("boom")
		}
		return &activities.ScaffolderStepResult{}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	// Step 2 references steps.create.output.repoUrl, which never existed
	// because step 1 failed, so the run stops there rather than resolving the
	// reference to an empty string.
	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "steps.create.output.repoUrl")

	// A plain (non-application) error is transient as far as the workflow
	// knows, so it retries — but only up to the bounded policy.
	s.Len(s.stubs.executed, maxStepAttempts)
	for _, in := range s.stubs.executed {
		s.Equal("create", in.StepID)
	}
}

func (s *ScaffolderWorkflowTestSuite) TestUnresolvableOutputFailsTheRun() {
	def := twoStepDefinition()
	def.Spec.Output = &scaffolder.Output{Text: "${{ steps.create.output.nothingHere }}"}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "output")
	s.Require().Len(s.stubs.cleanups, 1)
}

// --- dry run ----------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestDryRunPlansEveryStepAndPersistsThePlan() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	// A dry run never has real step outputs, so the second step's reference
	// must not break planning.
	in.Definition.Spec.Steps[1].Input = json.RawMessage(`{"message":"static"}`)
	in.Definition.Spec.Output = nil

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.executed, "a dry run must never execute a step")
	s.Require().Len(s.stubs.planned, 2)
	s.True(s.stubs.planned[0].DryRun)

	s.Require().Len(res.Plan, 2)
	s.Equal("create", res.Plan[0].Name)

	last := s.lastProgress()
	s.True(last.HasPlan)
	s.Len(last.Plan, 2)
	s.Equal("succeeded", last.Status)
	s.Require().Len(s.stubs.cleanups, 1)
}

func (s *ScaffolderWorkflowTestSuite) TestDryRunRecordsUnsupportedSteps() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Steps = in.Definition.Spec.Steps[:1]
	in.Definition.Spec.Output = nil

	s.stubs.planFn = func(activities.ScaffolderStepInput) (*activities.ScaffolderPlanResult, error) {
		return &activities.ScaffolderPlanResult{Unsupported: true}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(res.Plan, 1)
	s.Equal("unsupported", res.Plan[0].Kind)
	s.Equal("create", res.Plan[0].Name)
}

func (s *ScaffolderWorkflowTestSuite) TestDryRunSendsAnEmptyPlanWhenNothingChanges() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Steps = in.Definition.Spec.Steps[:1]
	in.Definition.Spec.Output = nil

	s.stubs.planFn = func(activities.ScaffolderStepInput) (*activities.ScaffolderPlanResult, error) {
		return &activities.ScaffolderPlanResult{}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)

	last := s.lastProgress()
	s.True(last.HasPlan, "an empty plan must still be written, so a stale plan cannot survive")
	s.Empty(last.Plan)
}

func (s *ScaffolderWorkflowTestSuite) TestDryRunPreviewFailureFailsTheRun() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil

	s.stubs.planFn = func(activities.ScaffolderStepInput) (*activities.ScaffolderPlanResult, error) {
		return nil, temporal.NewNonRetryableApplicationError(
			"dry-run preview unavailable: storage offline", activities.ErrTypeScaffolderInvalid, nil)
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "storage offline")
}

// --- cancellation -----------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestCancellationMidRunCleansUpAndReportsCancelled() {
	// Block inside the first step so the cancel lands mid-run rather than
	// after the workflow has already reached its cleanup.
	started := make(chan struct{})
	s.env.RegisterActivityWithOptions(
		func(ctx context.Context, in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
			s.stubs.executed = append(s.stubs.executed, in)
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderExecuteStep},
	)
	go func() {
		<-started
		s.env.CancelWorkflow()
	}()

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	res := s.result()

	s.Equal(ScaffolderStatusCancelled, res.Status)
	s.Contains(res.Error, "cancelled")

	s.Require().Len(s.stubs.cleanups, 1, "the work dir must be removed on cancellation")
	s.Equal("cancelled", s.lastProgress().Status,
		"the terminal writeback must run on a disconnected context after cancellation")
}

// --- progress query ---------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestProgressQueryReportsTerminalSnapshot() {
	s.stubs.executeFn = func(in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
		if in.StepID == "create" {
			return &activities.ScaffolderStepResult{Output: map[string]any{"repoUrl": "https://example.com/o"}}, nil
		}
		return &activities.ScaffolderStepResult{}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)

	val, err := s.env.QueryWorkflow(ScaffolderProgressQuery)
	s.Require().NoError(err)
	var progress ScaffolderProgress
	s.Require().NoError(val.Get(&progress))

	s.Equal(ScaffolderStatusSucceeded, progress.Status)
	s.Require().Len(progress.Steps, 2)
	s.Equal("succeeded", progress.Steps[0].Status)
	s.Equal("https://example.com/o", progress.Outputs["text"].(string)[len("created "):])
}

// --- timeouts ---------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestInvalidStepTimeoutFailsTheRun() {
	def := twoStepDefinition()
	def.Spec.Steps[0].Timeout = "not-a-duration"

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "timeout")
	s.Empty(s.stubs.executed)
}

func TestScaffolderWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(ScaffolderWorkflowTestSuite))
}

// TestParseStepTimeout is a plain table test for the duration parser, which is
// pure and does not need the workflow environment.
func TestParseStepTimeout(t *testing.T) {
	def := 10 * time.Minute
	tests := []struct {
		name    string
		in      string
		want    time.Duration
		wantErr bool
	}{
		{name: "empty falls back to the default", in: "", want: def},
		{name: "whitespace falls back to the default", in: "   ", want: def},
		{name: "parses a duration", in: "90s", want: 90 * time.Second},
		{name: "parses minutes", in: "5m", want: 5 * time.Minute},
		{name: "rejects a non-duration", in: "soon", wantErr: true},
		{name: "rejects zero", in: "0s", wantErr: true},
		{name: "rejects a negative duration", in: "-1m", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseStepTimeout(tt.in, def)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}

// --- regression guards for the adversarial review ---------------------------

// Cancellation ordering note.
//
// ScaffolderWorkflow sets WaitForCancellation on step activities and, on
// ctx.Done(), waits for the step future on a disconnected context before
// returning, so cleanup cannot delete the work dir out from under a live clone
// or render. That ordering is NOT observable here: the SDK's test environment
// resolves a cancelled activity's future immediately —
// testWorkflowEnvironmentImpl.RequestCancelActivity fires
// handle.callback(nil, NewCanceledError()) without consulting
// waitForCancelRequest (internal_workflow_testsuite.go:833) — whereas a real
// server gates completion on it (internal_event_handlers.go:690).
//
// So TestCancellationMidRunCleansUpAndReportsCancelled below covers the
// observable half (status, cleanup, terminal writeback on a disconnected
// context); the wait itself is only exercised against a real server.

// TestDryRunSkipsStepsThatDependOnEarlierOutput covers the canonical
// fetch -> render -> push shape: no step produces output during a dry run, so
// a reference to a prior step must downgrade that step to "unsupported"
// instead of failing the whole preview.
func (s *ScaffolderWorkflowTestSuite) TestDryRunSkipsStepsThatDependOnEarlierOutput() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	// spec.output is deliberately left in place: it reads
	// steps.create.output.repoUrl, which a dry run never produces, and must be
	// reported as unpreviewable rather than failing the whole preview.

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status,
		"a step that cannot be previewed must not fail the dry run")

	// Only the first step could be planned.
	s.Require().Len(s.stubs.planned, 1)
	s.Equal("create", s.stubs.planned[0].StepID)

	var unsupported []scaffolder.PlannedChange
	for _, c := range res.Plan {
		if c.Kind == "unsupported" {
			unsupported = append(unsupported, c)
		}
	}
	s.Require().Len(unsupported, 2, "the log step and the run output are both unpreviewable")
	s.Equal("log", unsupported[0].Name)
	s.Contains(unsupported[0].Description, "earlier step")
	s.Equal("output", unsupported[1].Name)
	s.Contains(unsupported[1].Description, "cannot be previewed")
	s.Empty(res.Outputs, "an unpreviewable output must not be reported as a real one")

	logStep, ok := stepByID(s.lastProgress().Steps, "log")
	s.Require().True(ok)
	s.Equal("skipped", logStep.Status)
}

// A live run must still fail on the same reference: only a dry run has the
// excuse that no step produced output.
func (s *ScaffolderWorkflowTestSuite) TestLiveRunStillFailsOnAnUnresolvableStepReference() {
	def := twoStepDefinition()
	def.Spec.Output = nil
	s.stubs.executeFn = func(activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
		return &activities.ScaffolderStepResult{Output: map[string]any{"other": "x"}}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "steps.create.output.repoUrl")
}

// TestRunClaimedBeforeAnythingElseCanFail: the first writeback records the
// workflow id, so a run can always be found and cancelled from the UI.
func (s *ScaffolderWorkflowTestSuite) TestRunIsClaimedWithWorkflowIDFirst() {
	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)

	s.Require().NotEmpty(s.stubs.progress)
	first := s.stubs.progress[0]
	s.Equal("running", first.Status)
	s.NotEmpty(first.WorkflowID, "the claiming write must record the workflow id")
	for _, st := range first.Steps {
		s.Equal("pending", st.Status, "the claiming write happens before any step runs")
	}
}

func (s *ScaffolderWorkflowTestSuite) TestRunLogRecordsStepLifecycle() {
	def := twoStepDefinition()
	def.Spec.Steps[1].If = "${{ parameters.wantLog }}"
	def.Spec.Output = nil
	in := baseInput(def)
	in.Parameters["wantLog"] = false

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)

	var lines []string
	for _, p := range s.stubs.progress {
		for _, l := range p.AppendLogs {
			lines = append(lines, l.Message)
		}
	}
	joined := strings.Join(lines, "\n")
	s.Contains(joined, "step create (github:repo:create) started")
	s.Contains(joined, "step create (github:repo:create) succeeded")
	s.Contains(joined, "step log (debug:log) skipped")

	// Logs are append-only on the route, so a line must never be sent twice.
	seen := map[string]int{}
	for _, l := range lines {
		seen[l]++
	}
	for line, n := range seen {
		s.Equal(1, n, "log line sent %d times: %s", n, line)
	}

	// A resolved step input can carry an installation token; it must never
	// reach the run log.
	s.NotContains(joined, "orders", "resolved step input must not be logged")
}

// --- dry-run escape must not mask real authoring errors ---------------------

// The escape hatch keys off the FAILING reference, not off the expression
// mentioning steps.* somewhere. A step that reads a prior step's output AND a
// misspelled parameter must still fail the dry run: masking it would report a
// broken template as previewed clean.
func (s *ScaffolderWorkflowTestSuite) TestDryRunStillFailsOnABadParameterAlongsideAStepRef() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil
	in.Definition.Spec.Steps[1].Input = json.RawMessage(
		`{"message":"made ${{ steps.create.output.repoUrl }} for ${{ parameters.misspelled }}"}`)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "parameters.misspelled")
}

func (s *ScaffolderWorkflowTestSuite) TestDryRunStillFailsOnABadParameterInACondition() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil
	in.Definition.Spec.Steps[0].If = "${{ parameters.misspelled }}"

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "parameters.misspelled")
	s.Empty(s.stubs.planned)
}

// A structural error is never an unresolved path, so it fails even in a dry run.
func (s *ScaffolderWorkflowTestSuite) TestDryRunStillFailsOnAnUnknownNamespace() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil
	in.Definition.Spec.Steps[0].Input = json.RawMessage(`{"name":"${{ nope.x }}"}`)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "unknown namespace")
}

// A quoted filter argument used to break the old text-scanning escape check,
// because the raw JSON escapes its quotes. Keying off the typed error removes
// that exposure entirely.
func (s *ScaffolderWorkflowTestSuite) TestDryRunHandlesQuotedFilterArguments() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil
	in.Definition.Spec.Steps = in.Definition.Spec.Steps[:1]
	in.Definition.Spec.Steps[0].Input = json.RawMessage(
		`{"name":"${{ parameters.absent | default(\"fallback\") }}"}`)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.planned, 1)
	s.JSONEq(`{"name":"fallback"}`, string(s.stubs.planned[0].Input))
}

// A live run resolves spec.output normally; only a dry run gets the escape.
func (s *ScaffolderWorkflowTestSuite) TestLiveRunStillFailsOnAnUnresolvableOutput() {
	def := twoStepDefinition()
	def.Spec.Output = &scaffolder.Output{Text: "${{ steps.create.output.nothingHere }}"}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(def))
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "failed to resolve output")
}

func (s *ScaffolderWorkflowTestSuite) TestRunLogEntriesCarryTheWorkflowClock() {
	s.env.ExecuteWorkflow(ScaffolderWorkflow, baseInput(twoStepDefinition()))
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)

	var seen int
	for _, p := range s.stubs.progress {
		for _, l := range p.AppendLogs {
			seen++
			s.NotEmpty(l.TS, "every log line must carry a timestamp: %s", l.Message)
			_, err := time.Parse(time.RFC3339, l.TS)
			s.NoError(err, "timestamp must be RFC3339: %s", l.TS)
		}
	}
	s.Positive(seen)
}

// A skippable `if` returns before the step's input is ever resolved, so the
// dry-run recheck has to cover BOTH. Otherwise a genuine bad reference reaches
// a "succeeded" dry run through the `if` door — the same masking the input
// path was already fixed for.
func (s *ScaffolderWorkflowTestSuite) TestDryRunStillFailsOnABadInputBehindASkippableIf() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil
	in.Definition.Spec.Steps[1].If = "${{ steps.create.output.ok }}"
	in.Definition.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ user.email }}"}`)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "user.email")
}

// The same shape with a sound input is still skipped, not failed.
func (s *ScaffolderWorkflowTestSuite) TestDryRunSkipsASoundStepBehindASkippableIf() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true
	in.Definition.Spec.Output = nil
	in.Definition.Spec.Steps[1].If = "${{ steps.create.output.ok }}"
	in.Definition.Spec.Steps[1].Input = json.RawMessage(`{"message":"${{ parameters.name }}"}`)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	logStep, ok := stepByID(s.lastProgress().Steps, "log")
	s.Require().True(ok)
	s.Equal("skipped", logStep.Status)
}

// A dry run whose output cannot be previewed must CLEAR any outputs left on
// the run record, not leave a previous run's values looking like this one's.
func (s *ScaffolderWorkflowTestSuite) TestDryRunClearsOutputsWhenTheyCannotBePreviewed() {
	in := baseInput(twoStepDefinition())
	in.DryRun = true

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)

	last := s.lastProgress()
	// An empty map cannot survive omitempty on the wire, so the flag is what
	// tells the activity to send `outputs` and clear the stored value.
	s.True(last.HasOutputs, "a terminal write must always claim the outputs field")
	s.Empty(last.Outputs)
}

// The 2h ceiling is enforced statically as well as at run time, so a bad
// timeout on a later step cannot fail the run after earlier steps have already
// created a repo and pushed to it.
func TestParseStepTimeout_RejectsAnExcessiveTimeout(t *testing.T) {
	_, err := parseStepTimeout("5h", 10*time.Minute)
	require.Error(t, err)
	require.Contains(t, err.Error(), "must not exceed")
}

func TestScaffolderValidate_RejectsBadStepTimeouts(t *testing.T) {
	tests := []struct {
		name    string
		timeout string
		want    string
	}{
		{name: "over the ceiling", timeout: "5h", want: "must not exceed"},
		{name: "zero", timeout: "0s", want: "must be positive"},
		{name: "negative", timeout: "-1m", want: "must be positive"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := twoStepDefinition()
			// Deliberately the LAST step: this is the case that used to blow
			// up mid-run, after the earlier steps had real side effects.
			def.Spec.Steps[1].Timeout = tt.timeout

			findings := scaffolder.Validate(&def, scaffolder.DescriptorCatalog{
				{Name: "github:repo:create", InputSchema: json.RawMessage(`{"type":"object"}`), OutputSchema: json.RawMessage(`{"type":"object","properties":{"repoUrl":{"type":"string"}}}`)},
				{Name: "debug:log", InputSchema: json.RawMessage(`{"type":"object"}`), OutputSchema: json.RawMessage(`{"type":"object"}`)},
			})

			var msgs []string
			for _, f := range findings {
				msgs = append(msgs, f.Error())
			}
			joined := strings.Join(msgs, "\n")
			require.Contains(t, joined, tt.want)
			require.Contains(t, joined, "spec.steps[1].timeout")
		})
	}
}
