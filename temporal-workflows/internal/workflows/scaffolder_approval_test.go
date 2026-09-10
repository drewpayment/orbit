package workflows

import (
	"encoding/json"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// approvalDefinition is a two-step definition: `gate` is an approval:request
// step whose sign-off the `log` step's input reads back.
func approvalDefinition() scaffolder.Definition {
	def := twoStepDefinition()
	def.Spec.Steps = []scaffolder.Step{
		{
			ID:     "gate",
			Name:   "Get sign-off",
			Action: approvalRequestAction,
			Input:  json.RawMessage(`{"message":"please review","approvers":["approver@example.com"],"timeoutHours":1}`),
		},
		{
			ID:     "log",
			Name:   "Log it",
			Action: "debug:log",
			Input:  json.RawMessage(`{"message":"resolved by ${{ steps.gate.output.approverId }}"}`),
		},
	}
	def.Spec.Output = nil
	return def
}

func (s *ScaffolderWorkflowTestSuite) signalApproval(approvalID string, approved bool, approverID, comment string, delay time.Duration) {
	s.env.RegisterDelayedCallback(func() {
		s.env.SignalWorkflow(ScaffolderApprovalSignal, ScaffolderApprovalSignalInput{
			ApprovalID: approvalID,
			Approved:   approved,
			ApproverID: approverID,
			Comment:    comment,
		})
	}, delay)
}

// --- approve ------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_ApprovedContinuesRun() {
	in := baseInput(approvalDefinition())
	approvalID := approvalStepID(in.RunID, "gate")
	s.signalApproval(approvalID, true, "approver@example.com", "looks good", time.Millisecond)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(res.Error)

	s.Require().Len(s.stubs.opened, 1)
	s.Equal(approvalID, s.stubs.opened[0].ApprovalID)
	s.Equal("please review", s.stubs.opened[0].Message)
	s.Equal(in.WorkspaceID, s.stubs.opened[0].WorkspaceID)

	s.Require().Len(s.stubs.resolved, 1)
	s.Equal("approved", s.stubs.resolved[0].Resolution)
	s.Equal("approver@example.com", s.stubs.resolved[0].ResolvedBy)

	// The later step reads the gate's output back through expressions.
	s.Require().Len(s.stubs.executed, 1)
	s.JSONEq(`{"message":"resolved by approver@example.com"}`, string(s.stubs.executed[0].Input))

	// The step-level and run-level "awaiting-approval" transition was
	// written before the terminal succeeded write.
	foundAwaiting := false
	for _, p := range s.stubs.progress {
		if p.Status == ScaffolderStatusAwaitingApproval {
			foundAwaiting = true
			break
		}
	}
	s.True(foundAwaiting, "run status must transition through awaiting-approval")
}

// --- reject ---------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_RejectWithoutContinueOnErrorFailsRun() {
	in := baseInput(approvalDefinition())
	approvalID := approvalStepID(in.RunID, "gate")
	s.signalApproval(approvalID, false, "approver@example.com", "needs work", time.Millisecond)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "rejected")
	s.Empty(s.stubs.executed, "the run must stop before the next step")

	s.Require().Len(s.stubs.resolved, 1)
	s.Equal("rejected", s.stubs.resolved[0].Resolution)
}

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_RejectWithContinueOnErrorContinues() {
	def := approvalDefinition()
	def.Spec.Steps[0].ContinueOnError = true
	// A rejected step produces no output (mirrors the generic runStep path:
	// r.exprCtx.Steps is only populated on success), so the next step must
	// not reference the gate's output here.
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"continuing despite rejection"}`)
	in := baseInput(def)
	approvalID := approvalStepID(in.RunID, "gate")
	s.signalApproval(approvalID, false, "approver@example.com", "", time.Millisecond)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.executed, 1, "continueOnError must let the run reach the next step")
}

// --- timeout ----------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_TimeoutFiresTimerNotCancel() {
	// No signal is ever sent, so the workflow's own timer (Temporal's test
	// environment auto-skips virtual time to the next event) is what
	// resolves the wait.
	in := baseInput(approvalDefinition())

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "timed out")
	s.Empty(s.stubs.executed)

	s.Require().Len(s.stubs.resolved, 1)
	s.Equal("rejected", s.stubs.resolved[0].Resolution)
}

// --- mismatched approval id --------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_MismatchedApprovalIDIsIgnored() {
	in := baseInput(approvalDefinition())
	approvalID := approvalStepID(in.RunID, "gate")

	// A signal for a different (stale or wrong) approval id must not resolve
	// the gate; the real signal that follows must still be honoured.
	s.signalApproval("some-other-run:gate", true, "wrong@example.com", "", time.Millisecond)
	s.signalApproval(approvalID, true, "approver@example.com", "", 2*time.Millisecond)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.resolved, 1)
	s.Equal("approver@example.com", s.stubs.resolved[0].ResolvedBy)
}

// --- cancellation -------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_CancelWhileAwaitingResolvesRow() {
	in := baseInput(approvalDefinition())

	s.env.RegisterDelayedCallback(func() {
		s.env.CancelWorkflow()
	}, time.Millisecond)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusCancelled, res.Status)
	s.Require().Len(s.stubs.opened, 1, "the row must have been opened before the cancel is observed")
	s.Require().Len(s.stubs.resolved, 1, "cancellation must resolve the row rather than leaving it orphaned")
	s.Equal("rejected", s.stubs.resolved[0].Resolution)
	s.Equal(s.stubs.opened[0].ApprovalID, approvalStepID(in.RunID, "gate"))
}

// --- dry run ------------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_DryRunNeverOpensARowOrWaits() {
	in := baseInput(approvalDefinition())
	in.DryRun = true

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.opened, "a dry run must never open a pending-approvals row")
	s.Empty(s.stubs.resolved)
	s.Empty(s.stubs.executed)

	s.Require().Len(res.Plan, 2)
	s.Equal("unsupported", res.Plan[0].Kind)
	s.Equal("gate", res.Plan[0].Name)
}

// --- if condition -------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_IfFalseSkipsWithoutOpeningOrWaiting() {
	def := approvalDefinition()
	def.Spec.Steps[0].If = "${{ parameters.wantApproval }}"
	// A skipped gate produces no output (same as a generic skipped step), so
	// the next step must not reference it.
	def.Spec.Steps[1].Input = json.RawMessage(`{"message":"no approval needed"}`)
	in := baseInput(def)
	in.Parameters["wantApproval"] = false

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.opened, "a skipped gate must never open a pending-approvals row")
	s.Empty(s.stubs.resolved)
	s.Require().Len(s.stubs.executed, 1, "the run must continue past a skipped gate")

	gate, ok := stepByID(s.lastProgress().Steps, "gate")
	s.Require().True(ok)
	s.Equal(stepStatusSkipped, gate.Status)
}

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_IfTrueOpensTheGate() {
	def := approvalDefinition()
	def.Spec.Steps[0].If = "${{ parameters.wantApproval }}"
	in := baseInput(def)
	in.Parameters["wantApproval"] = true
	approvalID := approvalStepID(in.RunID, "gate")
	s.signalApproval(approvalID, true, "approver@example.com", "", time.Millisecond)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.opened, 1, "a true condition must still open the gate")
}

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_MalformedIfFailsTheRun() {
	def := approvalDefinition()
	def.Spec.Steps[0].If = "${{ bogus.unknownNamespace }}"
	in := baseInput(def)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Empty(s.stubs.opened, "the run must fail before ever opening the gate")
	s.Empty(s.stubs.executed)
}

func (s *ScaffolderWorkflowTestSuite) TestApprovalStep_DryRunIfFalseRecordsSkippedNotUnsupported() {
	def := approvalDefinition()
	def.Spec.Steps[0].If = "${{ parameters.wantApproval }}"
	def.Spec.Output = nil
	in := baseInput(def)
	in.DryRun = true
	in.Parameters["wantApproval"] = false

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.opened)
	s.Require().NotEmpty(res.Plan)
	s.Equal("skipped", res.Plan[0].Kind, "a skipped-by-condition step is a distinct plan entry from an unplannable one")
	s.Equal("gate", res.Plan[0].Name)
}
