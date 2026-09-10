package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"go.temporal.io/sdk/activity"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

// nestedSingleStepDefinition is the default nested definition the shared
// SetupTest's ScaffolderResolveTemplateVersion stub returns when a test
// does not override resolveTemplateVerFn. A single debug:log step with no
// declared parameters, so it never depends on the outer run's own
// parameter page.
func nestedSingleStepDefinition() scaffolder.Definition {
	return scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata: scaffolder.Metadata{
			Name: "nested", Title: "Nested", Owner: "platform", TargetKind: "service",
		},
		Spec: scaffolder.Spec{
			Steps: []scaffolder.Step{
				{ID: "log", Name: "Log it", Action: "debug:log", Input: json.RawMessage(`{"message":"hi"}`)},
			},
			Output: &scaffolder.Output{Text: "nested: ${{ steps.log.output.repoUrl }}"},
		},
	}
}

// fetchTemplateComposeDefinition is a two-step outer definition: `compose`
// fetches a nested template, and `log` reads the composed step's output
// back — exercising output propagation.
func fetchTemplateComposeDefinition() scaffolder.Definition {
	return scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata: scaffolder.Metadata{
			Name: "outer", Title: "Outer", Owner: "platform", TargetKind: "service",
		},
		Spec: scaffolder.Spec{
			Steps: []scaffolder.Step{
				{ID: "compose", Name: "Compose", Action: fetchTemplateAction, Input: json.RawMessage(`{"templateDefinitionId":"def-nested"}`)},
				{ID: "log", Name: "Log it", Action: "debug:log", Input: json.RawMessage(`{"message":"got ${{ steps.compose.output.text }}"}`)},
			},
		},
	}
}

func fetchTemplateOneStepDefinition() scaffolder.Definition {
	return scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata: scaffolder.Metadata{
			Name: "outer", Title: "Outer", Owner: "platform", TargetKind: "service",
		},
		Spec: scaffolder.Spec{
			Steps: []scaffolder.Step{
				{ID: "compose", Name: "Compose", Action: fetchTemplateAction, Input: json.RawMessage(`{"templateDefinitionId":"def-nested"}`)},
			},
		},
	}
}

// --- composition / output propagation ---------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_ComposesAndPropagatesOutput() {
	in := baseInput(fetchTemplateComposeDefinition())
	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		return &activities.ScaffolderResolveTemplateVersionResult{
			DefinitionVersionID: "ver-nested",
			DefinitionID:        req.TemplateDefinitionID,
			Definition:          nestedSingleStepDefinition(),
		}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.versionsResolved, 1)
	s.Equal("def-nested", s.stubs.versionsResolved[0].TemplateDefinitionID)

	// Nested "log" plus outer "log" both dispatched through the shared
	// executeFn stub.
	s.Require().Len(s.stubs.executed, 2)
	var outerLogInput map[string]any
	for _, e := range s.stubs.executed {
		if e.StepID == "log" {
			s.Require().NoError(json.Unmarshal(e.Input, &outerLogInput))
		}
	}
	s.Equal("got nested: https://example.com/log", outerLogInput["message"])

	// The nested run's steps are flattened in, prefixed by the outer step id.
	flat, ok := stepByID(s.lastProgress().Steps, "compose.log")
	s.Require().True(ok)
	s.Equal("succeeded", flat.Status)

	composeStep, ok := stepByID(s.lastProgress().Steps, "compose")
	s.Require().True(ok)
	s.Equal("succeeded", composeStep.Status)
}

// --- cycle detection ----------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_SelfReferenceCaught() {
	in := baseInput(fetchTemplateOneStepDefinition())

	selfRefDef := scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata:   scaffolder.Metadata{Name: "a", Title: "A", Owner: "platform", TargetKind: "service"},
		Spec: scaffolder.Spec{
			Steps: []scaffolder.Step{
				{ID: "again", Name: "Again", Action: fetchTemplateAction, Input: json.RawMessage(`{"templateDefinitionId":"def-a"}`)},
			},
		},
	}

	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		return &activities.ScaffolderResolveTemplateVersionResult{
			DefinitionVersionID: "ver-a",
			DefinitionID:        "def-a",
			Definition:          selfRefDef,
		}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "cycle detected")
	s.Contains(res.Error, "ver-a → ver-a")
}

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_IndirectCycleCaughtWithFullPath() {
	in := baseInput(fetchTemplateOneStepDefinition())
	in.Definition.Spec.Steps[0].Input = json.RawMessage(`{"templateDefinitionId":"def-a"}`)

	defA := scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata:   scaffolder.Metadata{Name: "a", Owner: "platform"},
		Spec: scaffolder.Spec{Steps: []scaffolder.Step{
			{ID: "inner", Name: "Inner", Action: fetchTemplateAction, Input: json.RawMessage(`{"templateDefinitionId":"def-b"}`)},
		}},
	}
	defB := scaffolder.Definition{
		APIVersion: scaffolder.APIVersionV2,
		Kind:       scaffolder.KindTemplate,
		Metadata:   scaffolder.Metadata{Name: "b", Owner: "platform"},
		Spec: scaffolder.Spec{Steps: []scaffolder.Step{
			{ID: "inner", Name: "Inner", Action: fetchTemplateAction, Input: json.RawMessage(`{"templateDefinitionId":"def-a"}`)},
		}},
	}

	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		switch req.TemplateDefinitionID {
		case "def-a":
			return &activities.ScaffolderResolveTemplateVersionResult{DefinitionVersionID: "ver-a", DefinitionID: "def-a", Definition: defA}, nil
		case "def-b":
			return &activities.ScaffolderResolveTemplateVersionResult{DefinitionVersionID: "ver-b", DefinitionID: "def-b", Definition: defB}, nil
		}
		return nil, errors.New("unexpected definition id in test: " + req.TemplateDefinitionID)
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "cycle detected")
	s.Contains(res.Error, "ver-a → ver-b → ver-a")
}

// --- depth cap ------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_DepthCapTripsOnLongAcyclicChain() {
	in := baseInput(fetchTemplateOneStepDefinition())
	in.Definition.Spec.Steps[0].Input = json.RawMessage(`{"templateDefinitionId":"def-0"}`)

	chainDef := func(nextID string) scaffolder.Definition {
		return scaffolder.Definition{
			APIVersion: scaffolder.APIVersionV2,
			Kind:       scaffolder.KindTemplate,
			Metadata:   scaffolder.Metadata{Name: "chain", Owner: "platform"},
			Spec: scaffolder.Spec{Steps: []scaffolder.Step{
				{ID: "inner", Name: "Inner", Action: fetchTemplateAction, Input: json.RawMessage(fmt.Sprintf(`{"templateDefinitionId":%q}`, nextID))},
			}},
		}
	}

	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		n, err := strconv.Atoi(strings.TrimPrefix(req.TemplateDefinitionID, "def-"))
		s.Require().NoError(err)
		nextID := fmt.Sprintf("def-%d", n+1)
		return &activities.ScaffolderResolveTemplateVersionResult{
			DefinitionVersionID: "ver-" + req.TemplateDefinitionID,
			DefinitionID:        req.TemplateDefinitionID,
			Definition:          chainDef(nextID),
		}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Contains(res.Error, "depth exceeded")
	s.NotContains(res.Error, "cycle detected", "a long acyclic chain must not be mistaken for a cycle")
}

// --- dry run ----------------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_DryRunNeverExecutesNestedRealActions() {
	in := baseInput(fetchTemplateOneStepDefinition())
	in.DryRun = true
	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		return &activities.ScaffolderResolveTemplateVersionResult{
			DefinitionVersionID: "ver-nested",
			DefinitionID:        req.TemplateDefinitionID,
			Definition:          nestedSingleStepDefinition(),
		}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.executed, "a dry run must never execute any nested step for real")
	s.Require().Len(s.stubs.planned, 1, "only the nested step is planned")

	var found bool
	for _, c := range res.Plan {
		if c.Name == "compose.log" {
			found = true
		}
	}
	s.True(found, "the nested plan must be merged in with a prefixed name")
}

// --- cancellation -----------------------------------------------------------

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_NestedCancellationOnOuterCancel() {
	in := baseInput(fetchTemplateOneStepDefinition())
	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		return &activities.ScaffolderResolveTemplateVersionResult{
			DefinitionVersionID: "ver-nested",
			DefinitionID:        req.TemplateDefinitionID,
			Definition:          nestedSingleStepDefinition(),
		}, nil
	}

	started := make(chan struct{})
	var once sync.Once
	s.env.RegisterActivityWithOptions(
		func(ctx context.Context, in activities.ScaffolderStepInput) (*activities.ScaffolderStepResult, error) {
			s.stubs.executed = append(s.stubs.executed, in)
			once.Do(func() { close(started) })
			<-ctx.Done()
			return nil, ctx.Err()
		},
		activity.RegisterOptions{Name: activities.ActivityScaffolderExecuteStep},
	)

	go func() {
		<-started
		s.env.CancelWorkflow()
	}()

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusCancelled, res.Status)
}

// --- step.If (mirrors approval:request's own if-handling fix) --------------

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_IfFalseSkipsWithoutResolvingOrComposing() {
	def := fetchTemplateOneStepDefinition()
	def.Spec.Steps[0].If = "${{ parameters.wantCompose }}"
	in := baseInput(def)
	in.Parameters["wantCompose"] = false

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.versionsResolved, "a skipped step must never resolve a template version or compose")

	composeStep, ok := stepByID(s.lastProgress().Steps, "compose")
	s.Require().True(ok)
	s.Equal(stepStatusSkipped, composeStep.Status)
}

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_IfTrueComposes() {
	def := fetchTemplateOneStepDefinition()
	def.Spec.Steps[0].If = "${{ parameters.wantCompose }}"
	in := baseInput(def)
	in.Parameters["wantCompose"] = true
	s.stubs.resolveTemplateVerFn = func(req activities.ScaffolderResolveTemplateVersionInput) (*activities.ScaffolderResolveTemplateVersionResult, error) {
		return &activities.ScaffolderResolveTemplateVersionResult{
			DefinitionVersionID: "ver-nested",
			DefinitionID:        req.TemplateDefinitionID,
			Definition:          nestedSingleStepDefinition(),
		}, nil
	}

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Require().Len(s.stubs.versionsResolved, 1, "a true condition must still compose the nested template")
}

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_MalformedIfFailsTheRun() {
	def := fetchTemplateOneStepDefinition()
	def.Spec.Steps[0].If = "${{ bogus.unknownNamespace }}"
	in := baseInput(def)

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusFailed, res.Status)
	s.Empty(s.stubs.versionsResolved, "the run must fail before ever resolving a template version")
}

func (s *ScaffolderWorkflowTestSuite) TestFetchTemplateStep_DryRunIfFalseRecordsSkippedNotUnsupported() {
	def := fetchTemplateOneStepDefinition()
	def.Spec.Steps[0].If = "${{ parameters.wantCompose }}"
	in := baseInput(def)
	in.DryRun = true
	in.Parameters["wantCompose"] = false

	s.env.ExecuteWorkflow(ScaffolderWorkflow, in)
	res := s.result()

	s.Equal(ScaffolderStatusSucceeded, res.Status)
	s.Empty(s.stubs.versionsResolved)

	var composeEntry *scaffolder.PlannedChange
	for i := range res.Plan {
		if res.Plan[i].Name == "compose" {
			composeEntry = &res.Plan[i]
		}
	}
	s.Require().NotNil(composeEntry)
	s.Equal("skipped", composeEntry.Kind, "a skipped-by-condition step is a distinct plan entry from an unplannable one")
}
