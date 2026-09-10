package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed ado_pr_open.input.schema.json
var adoPROpenInputSchema []byte

//go:embed ado_pr_open.output.schema.json
var adoPROpenOutputSchema []byte

// ADOPROpen wraps ADORepoClient.CreatePullRequest: it opens a pull request
// against an existing Azure DevOps repository.
type ADOPROpen struct {
	connectionClient ADOConnectionClient
	clientFactory    ADOClientFactory
}

// NewADOPROpen constructs the ado:pr:open action.
func NewADOPROpen(connectionClient ADOConnectionClient, clientFactory ADOClientFactory) *ADOPROpen {
	if clientFactory == nil {
		clientFactory = defaultADOClientFactory()
	}
	return &ADOPROpen{connectionClient: connectionClient, clientFactory: clientFactory}
}

type adoPROpenInput struct {
	Connection   string `json:"connection"`
	Project      string `json:"project"`
	RepoID       string `json:"repoId"`
	SourceBranch string `json:"sourceBranch"`
	TargetBranch string `json:"targetBranch"`
	Title        string `json:"title"`
	Description  string `json:"description"`
}

type adoPROpenOutput struct {
	PRURL string `json:"prUrl"`
	PRID  string `json:"prId"`
}

// Name implements scaffolder.Action.
func (a *ADOPROpen) Name() string { return "ado:pr:open" }

// InputSchema implements scaffolder.Action.
func (a *ADOPROpen) InputSchema() json.RawMessage { return adoPROpenInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *ADOPROpen) OutputSchema() json.RawMessage { return adoPROpenOutputSchema }

// Plan describes the pull request that would be opened, without opening it.
func (a *ADOPROpen) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseADOPROpenInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "pr",
		Name:        in.Title,
		Description: fmt.Sprintf("open Azure DevOps pull request %q: %s -> %s", in.Title, in.SourceBranch, in.TargetBranch),
	}}, nil
}

// Execute opens the pull request and returns its id and URL.
func (a *ADOPROpen) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseADOPROpenInput(input)
	if err != nil {
		return nil, err
	}
	org, authHeader, baseURL, err := resolveADOConnection(ctx, a.connectionClient, in.Connection, rc.WorkspaceID, "ado:pr:open")
	if err != nil {
		return nil, err
	}

	rc.Heartbeat("ado:pr:open", in.Project, in.RepoID)
	client := a.clientFactory(baseURL, authHeader)
	result, err := client.CreatePullRequest(ctx, org, in.Project, in.RepoID, in.SourceBranch, in.TargetBranch, in.Title, in.Description)
	if err != nil {
		return nil, wrapADOError("ado:pr:open", err)
	}

	return json.Marshal(adoPROpenOutput{PRURL: result.PRURL, PRID: result.PRID})
}

func parseADOPROpenInput(raw json.RawMessage) (adoPROpenInput, error) {
	var in adoPROpenInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("ado:pr:open: %w: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	if err := requireNonEmpty("ado:pr:open", map[string]string{
		"connection":   in.Connection,
		"project":      in.Project,
		"repoId":       in.RepoID,
		"sourceBranch": in.SourceBranch,
		"targetBranch": in.TargetBranch,
		"title":        in.Title,
	}, []string{"connection", "project", "repoId", "sourceBranch", "targetBranch", "title"}); err != nil {
		return in, err
	}
	return in, nil
}
