package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed ado_pipeline_create.input.schema.json
var adoPipelineCreateInputSchema []byte

//go:embed ado_pipeline_create.output.schema.json
var adoPipelineCreateOutputSchema []byte

// defaultADOPipelineYAMLPath is used when a step omits yamlPath.
const defaultADOPipelineYAMLPath = "azure-pipelines.yml"

// ADOPipelineCreate wraps ADORepoClient.CreatePipeline: it creates a
// YAML-backed Azure DevOps pipeline pointing at a file that must already
// exist in the target repository.
//
// Bounded first cut (lead decision, 2026-09-10): the action does not
// generate pipeline YAML content. A missing yamlPath surfaces as whatever
// error Azure DevOps' own API returns; no special-cased friendly message.
// Multi-stage templates, variable-group wiring, and environment approvals
// are out of scope.
type ADOPipelineCreate struct {
	connectionClient ADOConnectionClient
	clientFactory    ADOClientFactory
}

// NewADOPipelineCreate constructs the ado:pipeline:create action.
func NewADOPipelineCreate(connectionClient ADOConnectionClient, clientFactory ADOClientFactory) *ADOPipelineCreate {
	if clientFactory == nil {
		clientFactory = defaultADOClientFactory()
	}
	return &ADOPipelineCreate{connectionClient: connectionClient, clientFactory: clientFactory}
}

type adoPipelineCreateInput struct {
	Connection string `json:"connection"`
	Project    string `json:"project"`
	Name       string `json:"name"`
	RepoID     string `json:"repoId"`
	YAMLPath   string `json:"yamlPath"`
}

type adoPipelineCreateOutput struct {
	PipelineURL string `json:"pipelineUrl"`
	PipelineID  string `json:"pipelineId"`
}

// Name implements scaffolder.Action.
func (a *ADOPipelineCreate) Name() string { return "ado:pipeline:create" }

// InputSchema implements scaffolder.Action.
func (a *ADOPipelineCreate) InputSchema() json.RawMessage { return adoPipelineCreateInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *ADOPipelineCreate) OutputSchema() json.RawMessage { return adoPipelineCreateOutputSchema }

// Plan describes the pipeline that would be created, without creating it.
func (a *ADOPipelineCreate) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseADOPipelineCreateInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "pipeline",
		Name:        in.Name,
		Description: fmt.Sprintf("create Azure DevOps pipeline %q in %s from %s (assumes the file already exists)", in.Name, in.Project, in.YAMLPath),
	}}, nil
}

// Execute creates the pipeline and returns its id and URL.
func (a *ADOPipelineCreate) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseADOPipelineCreateInput(input)
	if err != nil {
		return nil, err
	}
	org, authHeader, baseURL, err := resolveADOConnection(ctx, a.connectionClient, in.Connection, "ado:pipeline:create")
	if err != nil {
		return nil, err
	}

	rc.Heartbeat("ado:pipeline:create", in.Project, in.Name)
	client := a.clientFactory(baseURL, authHeader)
	result, err := client.CreatePipeline(ctx, org, in.Project, in.Name, in.RepoID, in.YAMLPath)
	if err != nil {
		return nil, wrapADOError("ado:pipeline:create", err)
	}

	return json.Marshal(adoPipelineCreateOutput{PipelineURL: result.PipelineURL, PipelineID: result.PipelineID})
}

func parseADOPipelineCreateInput(raw json.RawMessage) (adoPipelineCreateInput, error) {
	var in adoPipelineCreateInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("ado:pipeline:create: %w: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	if err := requireNonEmpty("ado:pipeline:create", map[string]string{
		"connection": in.Connection,
		"project":    in.Project,
		"name":       in.Name,
		"repoId":     in.RepoID,
	}, []string{"connection", "project", "name", "repoId"}); err != nil {
		return in, err
	}
	if strings.TrimSpace(in.YAMLPath) == "" {
		in.YAMLPath = defaultADOPipelineYAMLPath
	}
	return in, nil
}
