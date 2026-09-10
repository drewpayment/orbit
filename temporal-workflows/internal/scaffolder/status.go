package scaffolder

// Run and step statuses.
//
// These live in the engine package, not in internal/workflows, so the dispatch
// activities can be checked against them too: internal/workflows imports
// internal/activities, so the constants could not travel the other way.
//
// Every value here must exist in `action-runs.status` and
// `action-runs.steps[].status` in orbit-www, or a writeback is rejected.
// scaffolder_status_contract_test.go pins that.
const (
	RunStatusRunning          = "running"
	RunStatusSucceeded        = "succeeded"
	RunStatusFailed           = "failed"
	RunStatusCancelled        = "cancelled"
	RunStatusAwaitingApproval = "awaiting-approval"
)

const (
	StepStatusPending          = "pending"
	StepStatusRunning          = "running"
	StepStatusSucceeded        = "succeeded"
	StepStatusFailed           = "failed"
	StepStatusSkipped          = "skipped"
	StepStatusAwaitingApproval = "awaiting-approval"
)

// RunStatusesWritten is every run status ScaffolderWorkflow writes back. It is
// deliberately not "every status the collection allows": the workflow never
// writes `pending`, which orbit-www owns. `awaiting-approval` IS written, by
// an `approval:request` step parking the run on a human signal (Phase 4
// Task C).
var RunStatusesWritten = []string{
	RunStatusRunning,
	RunStatusSucceeded,
	RunStatusFailed,
	RunStatusCancelled,
	RunStatusAwaitingApproval,
}

// StepStatusesWritten is every per-step status ScaffolderWorkflow writes back.
var StepStatusesWritten = []string{
	StepStatusPending,
	StepStatusRunning,
	StepStatusSucceeded,
	StepStatusFailed,
	StepStatusSkipped,
	StepStatusAwaitingApproval,
}
