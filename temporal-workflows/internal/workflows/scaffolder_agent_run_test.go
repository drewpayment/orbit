package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// agentRunDefinition is a two-step definition: `create` produces a repoUrl
// the `agent` step's prompt reads back, exercising the plan's decision that
// agent:run's prompt may reference `${{ steps.*.output }}` from prior steps.
func agentRunDefinition() scaffolder.Definition {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{ID: "create", Name: "Create repo", Action: "github:repo:create", Input: json.RawMessage(`{"name":"${{ parameters.name }}"}`)},
		{ID: "agent", Name: "Run agent", Action: agentRunAction, Input: json.RawMessage(`{"prompt":"deploy ${{ steps.create.output.repoUrl }}"}`)},
	}
	def.Spec.Output = nil
	return def
}

// --- success ------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_SucceedsAndProducesOutput() {
	in := baseInput(agentRunDefinition())
	in.WorkspaceSlug = "acme"

	s.env.OnWorkflow(InfrastructureAgentWorkflow, mock.Anything, mock.Anything).Return(
		func(ctx workflow.Context, agentIn InfrastructureAgentInput) error {
			s.Equal("ws-1", agentIn.WorkspaceID)
			s.Equal("user-1", agentIn.UserID)
			s.Equal("llm-default", agentIn.LLMProviderID)
			s.Equal("deploy https://example.com/create", agentIn.InitialPrompt)
			return nil
		})

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.agentRunsCreated, 1)
	s.Equal("run-1-agent", s.stubs.agentRunsCreated[0].WorkflowID)
	s.Equal("deploy https://example.com/create", s.stubs.agentRunsCreated[0].Prompt)

	agentStep, ok := stepByID(s.lastProgress().Steps, "agent")
	s.Require().True(ok)
	s.Equal("succeeded", agentStep.Status)
	s.Equal("agent-run-run-1-agent", agentStep.Output["agentRunId"])
	s.Equal("completed", agentStep.Output["status"])
	s.Equal("/workspaces/acme/infra-agent/run-1-agent", agentStep.Output["url"])
}

func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_TitleDefaultsFromPrompt() {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{ID: "agent", Name: "Run agent", Action: agentRunAction, Input: json.RawMessage(`{"prompt":"do the thing"}`)},
	}
	def.Spec.Output = nil
	in := baseInput(def)

	s.env.OnWorkflow(InfrastructureAgentWorkflow, mock.Anything, mock.Anything).Return(
		func(workflow.Context, InfrastructureAgentInput) error { return nil })

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	s.Equal(ScaffolderStatusSucceeded, s.result().Status)
	s.Require().Len(s.stubs.agentRunsCreated, 1)
	s.Equal("do the thing", s.stubs.agentRunsCreated[0].Title)
}

// --- failure propagates ---------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_ChildFailurePropagatesAsStepFailure() {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{ID: "agent", Name: "Run agent", Action: agentRunAction, Input: json.RawMessage(`{"prompt":"do it"}`)},
	}
	def.Spec.Output = nil
	in := baseInput(def)

	s.env.OnWorkflow(InfrastructureAgentWorkflow, mock.Anything, mock.Anything).Return(
		func(workflow.Context, InfrastructureAgentInput) error { return errors.New("sandbox unavailable") })

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "sandbox unavailable")
	agentStep, ok := stepByID(s.lastProgress().Steps, "agent")
	s.Require().True(ok)
	s.Equal("failed", agentStep.Status)
}

func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_CreateActivityFailurePropagates() {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{ID: "agent", Name: "Run agent", Action: agentRunAction, Input: json.RawMessage(`{"prompt":"do it"}`)},
	}
	def.Spec.Output = nil
	in := baseInput(def)
	s.stubs.createAgentRunFn = func(activities.ScaffolderCreateAgentRunInput) (*activities.ScaffolderCreateAgentRunResult, error) {
		return nil, temporal.NewNonRetryableApplicationError("no LLM provider configured for this workspace", "ScaffolderInvalidStep", nil)
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "no LLM provider configured")
}

func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_RequiresAuthenticatedUser() {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{ID: "agent", Name: "Run agent", Action: agentRunAction, Input: json.RawMessage(`{"prompt":"do it"}`)},
	}
	def.Spec.Output = nil
	in := baseInput(def)
	in.UserID = ""

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "authenticated user")
	s.Empty(s.stubs.agentRunsCreated, "no row should be created for a run with no user")
}

// --- cancellation ---------------------------------------------------------

// TestAgentRunStep_CancelTerminatesChild cancels the run while the
// bookkeeping CreateAgentRun activity is in flight, i.e. before the child
// workflow is started. This is deliberately NOT a test of cancelling an
// already-running child: the Go SDK's test environment does not run an
// OnWorkflow-mocked child through the real coroutine/cancellation
// machinery (its replacement function is invoked outside the deterministic
// dispatcher, so neither workflow.Await nor a workflow-context
// ExecuteActivity call inside it reliably observes the parent's
// cancellation — confirmed empirically: both hang past the test
// environment's timeout). A real child (unmocked) does not have this
// limitation — see TestFetchTemplateStep_NestedCancellationOnOuterCancel,
// which exercises exactly that path against a real, unmocked
// ScaffolderWorkflow child. The behaviour under test here — the selector's
// ctx.Done() branch firing, the step failing as cancelled, and the run
// reporting cancelled overall, with ParentClosePolicy: TERMINATE configured
// as the backstop for whatever child the real server did manage to start —
// is the part this environment CAN prove.
func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_CancelTerminatesChild() {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{ID: "agent", Name: "Run agent", Action: agentRunAction, Input: json.RawMessage(`{"prompt":"do it"}`)},
	}
	def.Spec.Output = nil
	in := baseInput(def)

	started := make(chan struct{})
	var once sync.Once
	s.env.RegisterActivityWithOptions(
		func(ctx context.Context, in activities.ScaffolderCreateAgentRunInput) (*activities.ScaffolderCreateAgentRunResult, error) {
			s.stubs.agentRunsCreated = append(s.stubs.agentRunsCreated, in)
			once.Do(func() { close(started) })
			<-ctx.Done()
			return nil, ctx.Err()
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderCreateAgentRun},
	)

	go func() {
		<-started
		s.env.CancelWorkflow()
	}()

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusCancelled, res.Status)
	agentStep, ok := stepByID(s.lastProgress().Steps, "agent")
	s.Require().True(ok)
	s.Equal("failed", agentStep.Status)
	s.Equal("cancelled", agentStep.Error)
}

// --- dry run ----------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestAgentRunStep_DryRunNeverStartsAChild() {
	in := baseInput(agentRunDefinition())
	in.DryRun = true

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.agentRunsCreated, "a dry run must never create the AgentRuns row or start the child")

	var unsupported *scaffolder.PlannedChange
	for i := range res.Plan {
		if res.Plan[i].Name == "agent" {
			unsupported = &res.Plan[i]
		}
	}
	s.Require().NotNil(unsupported)
	s.Equal("unsupported", unsupported.Kind)
}
