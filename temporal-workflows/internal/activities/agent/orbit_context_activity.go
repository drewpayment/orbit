package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// OrbitContextClient is the contract the introspection activities depend
// on. Implemented by services.PayloadOrbitContextClient in production;
// tests substitute a fake.
type OrbitContextClient interface {
	ListApps(ctx context.Context, workspaceID string) ([]services.AppSummary, error)
	GetApp(ctx context.Context, workspaceID, appID string) (services.AppDetails, error)
	ListCloudAccounts(ctx context.Context, workspaceID string) ([]services.CloudAccountSummary, error)
}

// OrbitContextActivities back the orbit_* tools. They call the orbit-www
// internal API endpoints that return sanitized summaries of workspace
// apps and cloud accounts. Credentials are never returned by these tools.
type OrbitContextActivities struct {
	client OrbitContextClient
	logger *slog.Logger
}

// NewOrbitContextActivities constructs the activity group.
func NewOrbitContextActivities(client OrbitContextClient, logger *slog.Logger) *OrbitContextActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &OrbitContextActivities{client: client, logger: logger}
}

// --- inputs / outputs ---

// OrbitListAppsInput is the activity input for orbit_list_apps. WorkspaceID
// is taken from the workflow's input, never from LLM-supplied args, so the
// model can't reach across workspaces.
type OrbitListAppsInput struct {
	WorkspaceID string
}

// OrbitListAppsResult is the activity output. Mirrors AppSummary so the
// JSON shape the agent sees matches what the orbit-www API returns.
type OrbitListAppsResult struct {
	Apps []OrbitApp `json:"apps"`
}

// OrbitApp is the wire-friendly form returned to the agent.
type OrbitApp struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Status      string             `json:"status"`
	Repository  *OrbitAppRepository `json:"repository,omitempty"`
}

type OrbitAppRepository struct {
	URL    string `json:"url"`
	Owner  string `json:"owner"`
	Name   string `json:"name"`
	Branch string `json:"branch"`
}

// OrbitGetAppInput is the activity input. Both ids are required — the
// workflow injects WorkspaceID; the LLM supplies AppID via tool args.
type OrbitGetAppInput struct {
	WorkspaceID string
	AppID       string
}

// OrbitGetAppResult mirrors AppDetails. healthConfig and buildConfig are
// returned as opaque maps so the agent can render or pass them through
// without us having to mirror every nested shape.
type OrbitGetAppResult struct {
	App OrbitAppDetails `json:"app"`
}

type OrbitAppDetails struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	Description  string              `json:"description"`
	Status       string              `json:"status"`
	Repository   *OrbitAppRepository `json:"repository,omitempty"`
	HealthConfig map[string]any      `json:"health_config,omitempty"`
	BuildConfig  map[string]any      `json:"build_config,omitempty"`
}

// OrbitListCloudAccountsInput / Result.
type OrbitListCloudAccountsInput struct {
	WorkspaceID string
}

type OrbitListCloudAccountsResult struct {
	Accounts []OrbitCloudAccount `json:"accounts"`
}

// OrbitCloudAccount mirrors CloudAccountSummary. No credentials field —
// by design.
type OrbitCloudAccount struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Provider        string `json:"provider"`
	Region          string `json:"region"`
	Status          string `json:"status"`
	LastValidatedAt string `json:"last_validated_at,omitempty"`
}

// --- activities ---

// OrbitListApps returns every app in the workspace.
func (a *OrbitContextActivities) OrbitListApps(ctx context.Context, in OrbitListAppsInput) (OrbitListAppsResult, error) {
	if in.WorkspaceID == "" {
		return OrbitListAppsResult{}, temporal.NewNonRetryableApplicationError("workspace_id required", "InvalidInput", nil)
	}
	apps, err := a.client.ListApps(ctx, in.WorkspaceID)
	if err != nil {
		return OrbitListAppsResult{}, fmt.Errorf("orbit list apps: %w", err)
	}
	out := make([]OrbitApp, 0, len(apps))
	for _, app := range apps {
		out = append(out, OrbitApp{
			ID:          app.ID,
			Name:        app.Name,
			Description: app.Description,
			Status:      app.Status,
			Repository:  appRepoToOrbit(app.Repository),
		})
	}
	return OrbitListAppsResult{Apps: out}, nil
}

// OrbitGetApp returns full details of one app. Returns a non-retryable
// AppNotFound error when the app isn't in the workspace so the agent
// learns to adapt rather than the activity exhausting retries.
func (a *OrbitContextActivities) OrbitGetApp(ctx context.Context, in OrbitGetAppInput) (OrbitGetAppResult, error) {
	if in.WorkspaceID == "" || in.AppID == "" {
		return OrbitGetAppResult{}, temporal.NewNonRetryableApplicationError("workspace_id and app_id required", "InvalidInput", nil)
	}
	details, err := a.client.GetApp(ctx, in.WorkspaceID, in.AppID)
	if err != nil {
		if errors.Is(err, services.ErrAppNotFound) {
			return OrbitGetAppResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "AppNotFound", err)
		}
		return OrbitGetAppResult{}, fmt.Errorf("orbit get app: %w", err)
	}
	return OrbitGetAppResult{App: OrbitAppDetails{
		ID:           details.ID,
		Name:         details.Name,
		Description:  details.Description,
		Status:       details.Status,
		Repository:   appRepoToOrbit(details.Repository),
		HealthConfig: details.HealthConfig,
		BuildConfig:  details.BuildConfig,
	}}, nil
}

// OrbitListCloudAccounts returns every cloud account connected to the
// workspace. Provider / region / status only — credentials are never
// returned.
func (a *OrbitContextActivities) OrbitListCloudAccounts(ctx context.Context, in OrbitListCloudAccountsInput) (OrbitListCloudAccountsResult, error) {
	if in.WorkspaceID == "" {
		return OrbitListCloudAccountsResult{}, temporal.NewNonRetryableApplicationError("workspace_id required", "InvalidInput", nil)
	}
	accounts, err := a.client.ListCloudAccounts(ctx, in.WorkspaceID)
	if err != nil {
		return OrbitListCloudAccountsResult{}, fmt.Errorf("orbit list cloud accounts: %w", err)
	}
	out := make([]OrbitCloudAccount, 0, len(accounts))
	for _, acc := range accounts {
		out = append(out, OrbitCloudAccount{
			ID:              acc.ID,
			Name:            acc.Name,
			Provider:        acc.Provider,
			Region:          acc.Region,
			Status:          acc.Status,
			LastValidatedAt: acc.LastValidatedAt,
		})
	}
	return OrbitListCloudAccountsResult{Accounts: out}, nil
}

func appRepoToOrbit(r *services.AppRepository) *OrbitAppRepository {
	if r == nil {
		return nil
	}
	return &OrbitAppRepository{URL: r.URL, Owner: r.Owner, Name: r.Name, Branch: r.Branch}
}
