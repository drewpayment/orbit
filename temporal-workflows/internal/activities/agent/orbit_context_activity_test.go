package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakeOrbitContextClient struct {
	apps      []services.AppSummary
	app       services.AppDetails
	accounts  []services.CloudAccountSummary
	listErr   error
	getErr    error
	acctsErr  error
	gotWorkspaceID, gotAppID string
}

func (f *fakeOrbitContextClient) ListApps(_ context.Context, workspaceID string) ([]services.AppSummary, error) {
	f.gotWorkspaceID = workspaceID
	return f.apps, f.listErr
}
func (f *fakeOrbitContextClient) GetApp(_ context.Context, workspaceID, appID string) (services.AppDetails, error) {
	f.gotWorkspaceID, f.gotAppID = workspaceID, appID
	return f.app, f.getErr
}
func (f *fakeOrbitContextClient) ListCloudAccounts(_ context.Context, workspaceID string) ([]services.CloudAccountSummary, error) {
	f.gotWorkspaceID = workspaceID
	return f.accounts, f.acctsErr
}

func TestOrbitListApps_PassesThroughAndShapesResponse(t *testing.T) {
	fc := &fakeOrbitContextClient{
		apps: []services.AppSummary{
			{ID: "a-1", Name: "checkout", Description: "Shop frontend", Status: "active",
				Repository: &services.AppRepository{URL: "https://github.com/x/y", Branch: "main"}},
			{ID: "a-2", Name: "billing"},
		},
	}
	a := NewOrbitContextActivities(fc, nil)
	res, err := a.OrbitListApps(context.Background(), OrbitListAppsInput{WorkspaceID: "ws-1"})
	if err != nil {
		t.Fatal(err)
	}
	if fc.gotWorkspaceID != "ws-1" {
		t.Errorf("workspace not threaded: %q", fc.gotWorkspaceID)
	}
	if len(res.Apps) != 2 {
		t.Fatalf("apps = %d", len(res.Apps))
	}
	if res.Apps[0].Repository == nil || res.Apps[0].Repository.URL != "https://github.com/x/y" {
		t.Errorf("repo = %+v", res.Apps[0].Repository)
	}
	if res.Apps[1].Repository != nil {
		t.Errorf("expected nil repository for app 2; got %+v", res.Apps[1].Repository)
	}
}

func TestOrbitListApps_RequiresWorkspaceID(t *testing.T) {
	a := NewOrbitContextActivities(&fakeOrbitContextClient{}, nil)
	_, err := a.OrbitListApps(context.Background(), OrbitListAppsInput{})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestOrbitGetApp_HappyPath(t *testing.T) {
	fc := &fakeOrbitContextClient{
		app: services.AppDetails{
			ID: "a-1", Name: "checkout", Status: "active",
			Repository: &services.AppRepository{URL: "https://github.com/x/y"},
			HealthConfig: map[string]any{"url": "https://example.com/health"},
		},
	}
	a := NewOrbitContextActivities(fc, nil)
	res, err := a.OrbitGetApp(context.Background(), OrbitGetAppInput{WorkspaceID: "ws-1", AppID: "a-1"})
	if err != nil {
		t.Fatal(err)
	}
	if res.App.ID != "a-1" || res.App.Status != "active" {
		t.Errorf("app = %+v", res.App)
	}
	if res.App.HealthConfig["url"] != "https://example.com/health" {
		t.Errorf("health_config = %+v", res.App.HealthConfig)
	}
	if fc.gotAppID != "a-1" {
		t.Errorf("app id not threaded: %q", fc.gotAppID)
	}
}

func TestOrbitGetApp_NotFoundIsNonRetryable(t *testing.T) {
	fc := &fakeOrbitContextClient{getErr: services.ErrAppNotFound}
	a := NewOrbitContextActivities(fc, nil)
	_, err := a.OrbitGetApp(context.Background(), OrbitGetAppInput{WorkspaceID: "ws-1", AppID: "missing"})
	if err == nil {
		t.Fatal("expected error")
	}
	// Temporal wraps it; assert the underlying error message is preserved
	// so the agent's tool result can show "app not found in workspace".
	if !contains(err.Error(), "app not found") {
		t.Errorf("err = %v", err)
	}
}

func TestOrbitGetApp_RequiresIDs(t *testing.T) {
	a := NewOrbitContextActivities(&fakeOrbitContextClient{}, nil)
	for _, in := range []OrbitGetAppInput{
		{},
		{WorkspaceID: "ws"},
		{AppID: "a"},
	} {
		if _, err := a.OrbitGetApp(context.Background(), in); err == nil {
			t.Errorf("OrbitGetApp(%+v) should reject incomplete input", in)
		}
	}
}

func TestOrbitListCloudAccounts_PassesThrough(t *testing.T) {
	fc := &fakeOrbitContextClient{
		accounts: []services.CloudAccountSummary{
			{ID: "ca-1", Name: "prod-azure", Provider: "azure", Region: "westus", Status: "valid"},
		},
	}
	a := NewOrbitContextActivities(fc, nil)
	res, err := a.OrbitListCloudAccounts(context.Background(), OrbitListCloudAccountsInput{WorkspaceID: "ws-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Accounts) != 1 || res.Accounts[0].Provider != "azure" {
		t.Errorf("accounts = %+v", res.Accounts)
	}
}

func TestOrbitListCloudAccounts_PropagatesErr(t *testing.T) {
	fc := &fakeOrbitContextClient{acctsErr: errors.New("boom")}
	a := NewOrbitContextActivities(fc, nil)
	if _, err := a.OrbitListCloudAccounts(context.Background(), OrbitListCloudAccountsInput{WorkspaceID: "ws-1"}); err == nil {
		t.Fatal("expected error")
	}
}

// contains reuses test/strings rather than importing strings just for one
// substring check.
func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || (len(s) > 0 && stringIndex(s, sub) >= 0))
}

func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
