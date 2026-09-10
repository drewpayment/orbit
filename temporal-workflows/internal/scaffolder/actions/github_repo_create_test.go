package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeTokenService struct {
	token string
	err   error
	calls []string
}

func (f *fakeTokenService) GetInstallationToken(_ context.Context, installationID string) (string, error) {
	f.calls = append(f.calls, installationID)
	return f.token, f.err
}

type fakeGitHubRepoClient struct {
	createRepoURL string
	createErr     error
	lastToken     string

	gotOrg, gotName, gotDescription string
	gotPrivate                      bool

	fromTemplateURL                                        string
	fromTemplateErr                                        error
	gotSourceOwner, gotSourceRepo, gotTargetOrg, gotTarget string
	gotFromTemplateDescription                             string
	gotFromTemplatePrivate                                 bool
}

func (f *fakeGitHubRepoClient) CreateRepository(_ context.Context, org, name, description string, private bool) (string, error) {
	f.gotOrg, f.gotName, f.gotDescription, f.gotPrivate = org, name, description, private
	if f.createErr != nil {
		return "", f.createErr
	}
	return f.createRepoURL, nil
}

func (f *fakeGitHubRepoClient) CreateRepoFromTemplate(_ context.Context, sourceOwner, sourceRepo, targetOrg, targetName, description string, private bool) (string, error) {
	f.gotSourceOwner, f.gotSourceRepo, f.gotTargetOrg, f.gotTarget = sourceOwner, sourceRepo, targetOrg, targetName
	f.gotFromTemplateDescription, f.gotFromTemplatePrivate = description, private
	if f.fromTemplateErr != nil {
		return "", f.fromTemplateErr
	}
	return f.fromTemplateURL, nil
}

func TestGitHubRepoCreate_Execute(t *testing.T) {
	tok := &fakeTokenService{token: "tok-123"}
	client := &fakeGitHubRepoClient{createRepoURL: "https://github.com/acme/orders"}
	a := NewGitHubRepoCreate(tok, func(token string) GitHubRepoClient {
		client.lastToken = token
		return client
	})

	raw, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"org":"acme","name":"orders","description":"d","private":true,"installationId":"inst-1"}`))
	require.NoError(t, err)

	var out githubRepoCreateOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "https://github.com/acme/orders", out.RepoURL)
	assert.Equal(t, "orders", out.RepoName)
	assert.Equal(t, "tok-123", client.lastToken)
	assert.Equal(t, []string{"inst-1"}, tok.calls)
	assert.Equal(t, "acme", client.gotOrg)
	assert.True(t, client.gotPrivate)
}

func TestGitHubRepoCreate_MissingFields(t *testing.T) {
	a := NewGitHubRepoCreate(&fakeTokenService{}, func(string) GitHubRepoClient { return &fakeGitHubRepoClient{} })
	for _, input := range []string{
		`{"name":"orders","installationId":"i"}`,
		`{"org":"acme","installationId":"i"}`,
		`{"org":"acme","name":"orders"}`,
	} {
		_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(input))
		assert.Error(t, err, input)
	}
}

func TestGitHubRepoCreate_TokenServiceError(t *testing.T) {
	tok := &fakeTokenService{err: fmt.Errorf("boom")}
	a := NewGitHubRepoCreate(tok, func(string) GitHubRepoClient { return &fakeGitHubRepoClient{} })
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"org":"acme","name":"orders","installationId":"i"}`))
	assert.ErrorContains(t, err, "boom")
}

func TestGitHubRepoCreate_ClientError(t *testing.T) {
	client := &fakeGitHubRepoClient{createErr: fmt.Errorf("github says no")}
	a := NewGitHubRepoCreate(&fakeTokenService{token: "t"}, func(string) GitHubRepoClient { return client })
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"org":"acme","name":"orders","installationId":"i"}`))
	assert.ErrorContains(t, err, "github says no")
}

func TestGitHubRepoCreate_Plan(t *testing.T) {
	a := NewGitHubRepoCreate(&fakeTokenService{}, nil)
	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(`{"org":"acme","name":"orders","installationId":"i"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "repo", changes[0].Kind)
	assert.Equal(t, "orders", changes[0].Name)
}

func TestGitHubRepoCreate_SchemasAndRegistration(t *testing.T) {
	a := NewGitHubRepoCreate(&fakeTokenService{}, nil)
	assert.Equal(t, "github:repo:create", a.Name())
	var probe map[string]any
	require.NoError(t, json.Unmarshal(a.InputSchema(), &probe))
	require.NoError(t, json.Unmarshal(a.OutputSchema(), &probe))

	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("github:repo:create")
	require.True(t, ok)
	assert.Equal(t, "github", d.Family)
	assert.True(t, d.SupportsPlan)
}
