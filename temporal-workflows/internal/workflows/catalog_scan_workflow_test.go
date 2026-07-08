package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

func makeRepos(n int) []activities.RepoRef {
	repos := make([]activities.RepoRef, n)
	for i := 0; i < n; i++ {
		repos[i] = activities.RepoRef{
			Owner:         "acme",
			Name:          "repo-" + itoa(int32(i)),
			URL:           "https://github.com/acme/repo",
			DefaultBranch: "main",
		}
	}
	return repos
}

// TestCatalogScanWorkflow_FanOutAndAggregate verifies every enumerated repo is
// scanned and the per-repo counts roll up into the workflow result.
func TestCatalogScanWorkflow_FanOutAndAggregate(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var a *activities.CatalogScanActivities
	env.RegisterActivity(a.ListInstallationReposActivity)
	env.RegisterActivity(a.ScanRepoActivity)

	repos := makeRepos(3)
	env.OnActivity(a.ListInstallationReposActivity, mock.Anything, mock.Anything).Return(repos, nil)
	env.OnActivity(a.ScanRepoActivity, mock.Anything, mock.Anything).
		Return(activities.ScanRepoResult{Proposed: 2, Imported: 1}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		InstallationID: "123",
		WorkspaceID:    "ws-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res CatalogScanWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, 3, res.ReposScanned)
	require.Equal(t, 0, res.ReposFailed)
	require.Equal(t, 6, res.Proposed)
	require.Equal(t, 3, res.Imported)
	require.NotEmpty(t, res.ScanRunID)
}

// TestCatalogScanWorkflow_GlobalScanEmptyWorkspace verifies a global scan (WP8):
// an empty WorkspaceID flows through enumeration and the fan-out unchanged — the
// workspace is simply not required — and the activities receive the empty value.
func TestCatalogScanWorkflow_GlobalScanEmptyWorkspace(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var a *activities.CatalogScanActivities
	env.RegisterActivity(a.ListInstallationReposActivity)
	env.RegisterActivity(a.ScanRepoActivity)

	repos := makeRepos(2)
	env.OnActivity(a.ListInstallationReposActivity, mock.Anything,
		mock.MatchedBy(func(in activities.ListInstallationReposInput) bool {
			return in.InstallationID == "123" && in.WorkspaceID == ""
		})).Return(repos, nil)
	env.OnActivity(a.ScanRepoActivity, mock.Anything,
		mock.MatchedBy(func(in activities.ScanRepoInput) bool { return in.WorkspaceID == "" })).
		Return(activities.ScanRepoResult{Proposed: 1, Imported: 1}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		InstallationID: "123",
		WorkspaceID:    "",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res CatalogScanWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, 2, res.ReposScanned)
	require.Equal(t, 2, res.Proposed)
	require.Equal(t, 2, res.Imported)
}

// TestCatalogScanWorkflow_PartialFailureTolerant verifies that one repo whose
// scan activity fails does not fail the whole scan — it is counted as failed
// and the rest complete.
func TestCatalogScanWorkflow_PartialFailureTolerant(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var a *activities.CatalogScanActivities
	env.RegisterActivity(a.ListInstallationReposActivity)
	env.RegisterActivity(a.ScanRepoActivity)

	repos := makeRepos(3) // repo-0, repo-1, repo-2
	env.OnActivity(a.ListInstallationReposActivity, mock.Anything, mock.Anything).Return(repos, nil)

	// repo-1's scan fails non-retryably (e.g. deleted mid-scan); others succeed.
	env.OnActivity(a.ScanRepoActivity, mock.Anything,
		mock.MatchedBy(func(in activities.ScanRepoInput) bool { return in.Repo.Name == "repo-1" })).
		Return(activities.ScanRepoResult{}, temporal.NewNonRetryableApplicationError("repo unreadable", "GitHubUnreadable", nil))
	env.OnActivity(a.ScanRepoActivity, mock.Anything, mock.Anything).
		Return(activities.ScanRepoResult{Proposed: 1, Imported: 0}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		InstallationID: "123",
		WorkspaceID:    "ws-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res CatalogScanWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, 2, res.ReposScanned)
	require.Equal(t, 1, res.ReposFailed)
	require.Equal(t, 2, res.Proposed)
}

// TestCatalogScanWorkflow_ContinueAsNewPastThreshold verifies that more than
// catalogScanCANThreshold repos triggers continue-as-new carrying the remaining
// repos and running totals.
func TestCatalogScanWorkflow_ContinueAsNewPastThreshold(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var a *activities.CatalogScanActivities
	env.RegisterActivity(a.ListInstallationReposActivity)
	env.RegisterActivity(a.ScanRepoActivity)

	total := catalogScanCANThreshold + 50 // 250
	repos := makeRepos(total)
	env.OnActivity(a.ListInstallationReposActivity, mock.Anything, mock.Anything).Return(repos, nil)
	env.OnActivity(a.ScanRepoActivity, mock.Anything, mock.Anything).
		Return(activities.ScanRepoResult{Proposed: 1, Imported: 0}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		InstallationID: "123",
		WorkspaceID:    "ws-1",
	})

	require.True(t, env.IsWorkflowCompleted())

	// A continue-as-new surfaces as a ContinueAsNewError from GetWorkflowError.
	err := env.GetWorkflowError()
	require.Error(t, err)
	var canErr *workflow.ContinueAsNewError
	require.ErrorAs(t, err, &canErr)

	// Decode the carry-over: the first run scanned exactly the threshold and
	// handed off the remaining 50 with accumulated totals.
	carry := decodeCatalogCarry(t, canErr)
	require.Len(t, carry.RemainingRepos, 50)
	require.Equal(t, catalogScanCANThreshold, carry.Totals.ReposScanned)
	require.Equal(t, catalogScanCANThreshold, carry.Totals.Proposed)
	require.NotEmpty(t, carry.ScanRunID)
}

// TestCatalogScanWorkflow_ContinueAsNewResumesWithoutRelist verifies a resumed
// (post-CAN) run scans its carried repos and does NOT re-enumerate — proving the
// carry-over path skips ListInstallationReposActivity.
func TestCatalogScanWorkflow_ContinueAsNewResumesWithoutRelist(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var a *activities.CatalogScanActivities
	env.RegisterActivity(a.ListInstallationReposActivity)
	env.RegisterActivity(a.ScanRepoActivity)

	// No ListInstallationReposActivity expectation — it must not be called.
	env.OnActivity(a.ScanRepoActivity, mock.Anything, mock.Anything).
		Return(activities.ScanRepoResult{Proposed: 1}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		InstallationID: "123",
		WorkspaceID:    "ws-1",
		RemainingRepos: makeRepos(3),
		ScanRunID:      "scan-abc",
		Totals:         CatalogScanTotals{ReposScanned: 10, Proposed: 20},
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res CatalogScanWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, "scan-abc", res.ScanRunID)
	require.Equal(t, 13, res.ReposScanned) // 10 carried + 3 this run
	require.Equal(t, 23, res.Proposed)     // 20 carried + 3 this run
}

// TestCatalogScanWorkflow_ADOProviderDispatch verifies that Provider
// "azure-devops" dispatches to the ADO activities (ListADOReposActivity /
// ScanADORepoActivity) and NOT the GitHub ones, while the fan-out and
// aggregation are identical.
func TestCatalogScanWorkflow_ADOProviderDispatch(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var gh *activities.CatalogScanActivities
	var ado *activities.ADOScanActivities
	env.RegisterActivity(gh.ListInstallationReposActivity)
	env.RegisterActivity(gh.ScanRepoActivity)
	env.RegisterActivity(ado.ListADOReposActivity)
	env.RegisterActivity(ado.ScanADORepoActivity)

	repos := makeRepos(3)
	// ADO list receives the ConnectionID; GitHub list must never be called.
	env.OnActivity(ado.ListADOReposActivity, mock.Anything,
		mock.MatchedBy(func(in activities.ListADOReposInput) bool { return in.ConnectionID == "conn-1" })).
		Return(repos, nil)
	env.OnActivity(ado.ScanADORepoActivity, mock.Anything,
		mock.MatchedBy(func(in activities.ScanADORepoInput) bool {
			return in.ConnectionID == "conn-1" && in.WorkspaceID == "ws-1"
		})).
		Return(activities.ScanRepoResult{Proposed: 2, Imported: 1}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		Provider:     "azure-devops",
		ConnectionID: "conn-1",
		WorkspaceID:  "ws-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res CatalogScanWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, 3, res.ReposScanned)
	require.Equal(t, 6, res.Proposed)
	require.Equal(t, 3, res.Imported)
	require.NotEmpty(t, res.ScanRunID)

	env.AssertNotCalled(t, "ListInstallationReposActivity", mock.Anything, mock.Anything)
	env.AssertNotCalled(t, "ScanRepoActivity", mock.Anything, mock.Anything)
}

// TestCatalogScanWorkflow_GitHubDefaultUnchanged verifies an explicit
// Provider:"github" behaves exactly like the empty-provider default: it
// dispatches to the GitHub activities.
func TestCatalogScanWorkflow_GitHubDefaultUnchanged(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var gh *activities.CatalogScanActivities
	var ado *activities.ADOScanActivities
	env.RegisterActivity(gh.ListInstallationReposActivity)
	env.RegisterActivity(gh.ScanRepoActivity)
	env.RegisterActivity(ado.ListADOReposActivity)
	env.RegisterActivity(ado.ScanADORepoActivity)

	repos := makeRepos(2)
	env.OnActivity(gh.ListInstallationReposActivity, mock.Anything, mock.Anything).Return(repos, nil)
	env.OnActivity(gh.ScanRepoActivity, mock.Anything, mock.Anything).
		Return(activities.ScanRepoResult{Proposed: 1}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		Provider:       "github",
		InstallationID: "123",
		WorkspaceID:    "ws-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res CatalogScanWorkflowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, 2, res.ReposScanned)
	require.Equal(t, 2, res.Proposed)

	env.AssertNotCalled(t, "ListADOReposActivity", mock.Anything, mock.Anything)
	env.AssertNotCalled(t, "ScanADORepoActivity", mock.Anything, mock.Anything)
}

// TestCatalogScanWorkflow_UnknownProviderFailsClosed verifies an unknown
// non-empty Provider is rejected with a non-retryable error before any activity
// is scheduled.
func TestCatalogScanWorkflow_UnknownProviderFailsClosed(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var gh *activities.CatalogScanActivities
	var ado *activities.ADOScanActivities
	env.RegisterActivity(gh.ListInstallationReposActivity)
	env.RegisterActivity(gh.ScanRepoActivity)
	env.RegisterActivity(ado.ListADOReposActivity)
	env.RegisterActivity(ado.ScanADORepoActivity)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		Provider:     "gitlab",
		ConnectionID: "conn-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()
	require.Error(t, err)

	var appErr *temporal.ApplicationError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, "UnsupportedProvider", appErr.Type())
	require.True(t, appErr.NonRetryable())

	env.AssertNotCalled(t, "ListInstallationReposActivity", mock.Anything, mock.Anything)
	env.AssertNotCalled(t, "ListADOReposActivity", mock.Anything, mock.Anything)
}

// TestCatalogScanWorkflow_ADOCarriesProviderThroughCAN verifies continue-as-new
// carries Provider + ConnectionID (so the resumed run keeps dispatching to ADO).
func TestCatalogScanWorkflow_ADOCarriesProviderThroughCAN(t *testing.T) {
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()

	var ado *activities.ADOScanActivities
	env.RegisterActivity(ado.ListADOReposActivity)
	env.RegisterActivity(ado.ScanADORepoActivity)

	total := catalogScanCANThreshold + 50 // 250
	repos := makeRepos(total)
	env.OnActivity(ado.ListADOReposActivity, mock.Anything, mock.Anything).Return(repos, nil)
	env.OnActivity(ado.ScanADORepoActivity, mock.Anything, mock.Anything).
		Return(activities.ScanRepoResult{Proposed: 1}, nil)

	env.ExecuteWorkflow(CatalogScanWorkflow, CatalogScanWorkflowInput{
		Provider:     "azure-devops",
		ConnectionID: "conn-1",
		WorkspaceID:  "ws-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	err := env.GetWorkflowError()
	require.Error(t, err)
	var canErr *workflow.ContinueAsNewError
	require.ErrorAs(t, err, &canErr)

	carry := decodeCatalogCarry(t, canErr)
	require.Equal(t, "azure-devops", carry.Provider)
	require.Equal(t, "conn-1", carry.ConnectionID)
	require.Len(t, carry.RemainingRepos, 50)
	require.Equal(t, catalogScanCANThreshold, carry.Totals.ReposScanned)
}

// decodeCatalogCarry pulls the typed CatalogScanWorkflowInput out of a
// ContinueAsNewError's encoded payload.
func decodeCatalogCarry(t *testing.T, canErr *workflow.ContinueAsNewError) CatalogScanWorkflowInput {
	t.Helper()
	require.NotNil(t, canErr.Input, "CAN error carried no input")
	dc := converter.GetDefaultDataConverter()
	var carry CatalogScanWorkflowInput
	require.NoError(t, dc.FromPayloads(canErr.Input, &carry))
	return carry
}
