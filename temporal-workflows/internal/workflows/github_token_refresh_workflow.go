package workflows

import (
	"errors"
	"math/rand"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// successRefreshInterval is how long to wait after a successful refresh.
	// GitHub App installation tokens live ~60 minutes; refresh with margin so a
	// slow refresh never lets the live token fully expire.
	successRefreshInterval = 45 * time.Minute

	// failureInitialBackoff / failureMaxBackoff bound the wait between retries
	// after a failed refresh. Far shorter than the success cadence so a
	// transient outage recovers in minutes, not an hour.
	failureInitialBackoff = 1 * time.Minute
	failureMaxBackoff     = 30 * time.Minute

	// escalationWindow is how long a connection may keep failing before we stop
	// silently self-healing and escalate to needs_reconnect (action required).
	escalationWindow = 1 * time.Hour

	// maxJitterSeconds spreads refreshes across installations to avoid a
	// thundering herd when many tokens were issued at the same time.
	maxJitterSeconds = 60

	// maxIterationsBeforeContinueAsNew caps workflow history growth. Without
	// this the history grows unbounded and eventually fails the workflow,
	// silently breaking refresh for the installation.
	maxIterationsBeforeContinueAsNew = 100

	// TerminalInstallationErrorType marks a refresh failure that a human must
	// fix (reconnect). Activity clients return a NonRetryableApplicationError of
	// this type; the workflow escalates immediately when it sees one.
	TerminalInstallationErrorType = "TerminalInstallationError"

	// Installation status values written via UpdateInstallationStatusActivity.
	statusActive         = "active"
	statusRefreshFailed  = "refresh_failed"
	statusNeedsReconnect = "needs_reconnect"
)

type GitHubTokenRefreshWorkflowInput struct {
	InstallationID string // Payload document ID (not GitHub installation ID)
	// ConsecutiveFailures and FirstFailureAt carry the failure streak across
	// ContinueAsNew so backoff and escalation survive history rollovers.
	ConsecutiveFailures int
	FirstFailureAt      time.Time
}

type RefreshTokenResult struct {
	Success      bool
	ExpiresAt    time.Time
	ErrorMessage string
}

// failureBackoff returns an exponential backoff duration for the given
// consecutive-failure count, capped at failureMaxBackoff.
func failureBackoff(consecutiveFailures int) time.Duration {
	if consecutiveFailures < 1 {
		consecutiveFailures = 1
	}
	backoff := failureInitialBackoff
	for i := 1; i < consecutiveFailures; i++ {
		backoff *= 2
		if backoff >= failureMaxBackoff {
			return failureMaxBackoff
		}
	}
	if backoff > failureMaxBackoff {
		return failureMaxBackoff
	}
	return backoff
}

// refreshJitter returns a deterministic (replay-safe) random jitter duration.
func refreshJitter(ctx workflow.Context) time.Duration {
	var jitterSeconds int
	_ = workflow.SideEffect(ctx, func(workflow.Context) interface{} {
		return rand.Intn(maxJitterSeconds)
	}).Get(&jitterSeconds)
	return time.Duration(jitterSeconds) * time.Second
}

// isTerminalRefreshError reports whether a refresh activity error is a terminal,
// human-actionable failure (vs. a transient one worth retrying).
func isTerminalRefreshError(err error) bool {
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		return appErr.Type() == TerminalInstallationErrorType
	}
	return false
}

// GitHubTokenRefreshWorkflow continuously refreshes a GitHub App installation
// token. It self-heals transient failures with bounded backoff, escalates to
// needs_reconnect only when a failure is terminal or has persisted past the
// escalation window, and rolls over its history via ContinueAsNew so it can run
// for the life of the installation.
func GitHubTokenRefreshWorkflow(ctx workflow.Context, input GitHubTokenRefreshWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting GitHub token refresh workflow",
		"installationId", input.InstallationID,
		"consecutiveFailures", input.ConsecutiveFailures)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	refreshSignal := workflow.GetSignalChannel(ctx, "trigger-refresh")
	consecutiveFailures := input.ConsecutiveFailures
	firstFailureAt := input.FirstFailureAt
	iterations := 0

	updateStatus := func(status, reason string) {
		if err := workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity",
			input.InstallationID, status, reason).Get(ctx, nil); err != nil {
			logger.Error("Failed to update installation status", "status", status, "error", err)
		}
	}

	for {
		// Refresh the token. (On the first iteration this is the immediate
		// refresh-on-start; thereafter it follows the timer/signal wait below.)
		var result RefreshTokenResult
		err := workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)

		var waitDuration time.Duration
		if err != nil {
			consecutiveFailures++
			if firstFailureAt.IsZero() {
				firstFailureAt = workflow.Now(ctx)
			}
			terminal := isTerminalRefreshError(err)
			elapsed := workflow.Now(ctx).Sub(firstFailureAt)
			logger.Error("Token refresh failed",
				"error", err,
				"consecutiveFailures", consecutiveFailures,
				"terminal", terminal,
				"failingFor", elapsed.String())

			// Escalate to a terminal, human-actionable state when the failure
			// is unrecoverable or has persisted beyond the escalation window.
			if terminal || elapsed >= escalationWindow {
				logger.Warn("Escalating installation to needs_reconnect",
					"installationId", input.InstallationID,
					"terminal", terminal,
					"failingFor", elapsed.String())
				updateStatus(statusNeedsReconnect, err.Error())
				return nil // Stop self-healing; recovery now requires a human reconnect.
			}

			updateStatus(statusRefreshFailed, err.Error())
			waitDuration = failureBackoff(consecutiveFailures)
		} else {
			consecutiveFailures = 0
			firstFailureAt = time.Time{}
			logger.Info("Token refresh succeeded", "expiresAt", result.ExpiresAt)
			updateStatus(statusActive, "")
			waitDuration = successRefreshInterval
		}

		waitDuration += refreshJitter(ctx)

		iterations++
		if iterations >= maxIterationsBeforeContinueAsNew {
			logger.Info("Rolling over workflow history via ContinueAsNew", "iterations", iterations)
			return workflow.NewContinueAsNewError(ctx, GitHubTokenRefreshWorkflow, GitHubTokenRefreshWorkflowInput{
				InstallationID:      input.InstallationID,
				ConsecutiveFailures: consecutiveFailures,
				FirstFailureAt:      firstFailureAt,
			})
		}

		// Wait for the next scheduled refresh, or a manual trigger-refresh signal.
		selector := workflow.NewSelector(ctx)
		timerFuture := workflow.NewTimer(ctx, waitDuration)
		selector.AddFuture(timerFuture, func(workflow.Future) {
			logger.Info("Refresh timer fired", "waited", waitDuration.String())
		})
		selector.AddReceive(refreshSignal, func(c workflow.ReceiveChannel, _ bool) {
			c.Receive(ctx, nil)
			logger.Info("Manual refresh signal received, triggering immediate refresh")
		})
		selector.Select(ctx)
	}
}
