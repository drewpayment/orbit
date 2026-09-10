package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed ado_repo_create.input.schema.json
var adoRepoCreateInputSchema []byte

//go:embed ado_repo_create.output.schema.json
var adoRepoCreateOutputSchema []byte

// ADORepoCreate wraps ADORepoClient.CreateRepository: it creates an empty
// Azure DevOps repository inside an existing project, authenticating via a
// GitConnections id rather than a raw PAT (see resolveADOConnection).
type ADORepoCreate struct {
	connectionClient ADOConnectionClient
	clientFactory    ADOClientFactory
}

// NewADORepoCreate constructs the ado:repo:create action.
func NewADORepoCreate(connectionClient ADOConnectionClient, clientFactory ADOClientFactory) *ADORepoCreate {
	if clientFactory == nil {
		clientFactory = defaultADOClientFactory()
	}
	return &ADORepoCreate{connectionClient: connectionClient, clientFactory: clientFactory}
}

type adoRepoCreateInput struct {
	Connection string `json:"connection"`
	Project    string `json:"project"`
	Name       string `json:"name"`
}

type adoRepoCreateOutput struct {
	RepoURL  string `json:"repoUrl"`
	RepoID   string `json:"repoId"`
	CloneURL string `json:"cloneUrl"`
	Project  string `json:"project"`
}

// Name implements scaffolder.Action.
func (a *ADORepoCreate) Name() string { return "ado:repo:create" }

// InputSchema implements scaffolder.Action.
func (a *ADORepoCreate) InputSchema() json.RawMessage { return adoRepoCreateInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *ADORepoCreate) OutputSchema() json.RawMessage { return adoRepoCreateOutputSchema }

// Plan describes the repository that would be created, without creating it.
func (a *ADORepoCreate) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseADORepoCreateInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "repo",
		Name:        in.Name,
		Description: fmt.Sprintf("create Azure DevOps repository %s/%s", in.Project, in.Name),
	}}, nil
}

// Execute creates the repository and returns its identifiers and URLs.
func (a *ADORepoCreate) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseADORepoCreateInput(input)
	if err != nil {
		return nil, err
	}
	org, authHeader, baseURL, err := resolveADOConnection(ctx, a.connectionClient, in.Connection, rc.WorkspaceID, "ado:repo:create")
	if err != nil {
		return nil, err
	}

	rc.Heartbeat("ado:repo:create", in.Project, in.Name)
	client := a.clientFactory(baseURL, authHeader)
	result, err := client.CreateRepository(ctx, org, in.Project, in.Name)
	if err != nil {
		return nil, wrapADOError("ado:repo:create", err)
	}

	return json.Marshal(adoRepoCreateOutput{
		RepoURL:  result.RepoURL,
		RepoID:   result.RepoID,
		CloneURL: result.CloneURL,
		Project:  result.Project,
	})
}

func parseADORepoCreateInput(raw json.RawMessage) (adoRepoCreateInput, error) {
	var in adoRepoCreateInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("ado:repo:create: %w: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	if err := requireNonEmpty("ado:repo:create", map[string]string{
		"connection": in.Connection,
		"project":    in.Project,
		"name":       in.Name,
	}, []string{"connection", "project", "name"}); err != nil {
		return in, err
	}
	return in, nil
}
