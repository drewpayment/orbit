package workflows

import (
	"context"
	"encoding/json"
	"errors"
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
