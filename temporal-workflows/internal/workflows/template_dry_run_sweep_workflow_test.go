package workflows

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

type sweepStubs struct {
	listResult *activities.ListPublishedTemplatesWithFixturesResult
	listErr    error

	triggered []activities.TriggerTemplateDryRunInput
	triggerFn func(in activities.TriggerTemplateDryRunInput) (*activities.TriggerTemplateDryRunResult, error)
}

type TemplateDryRunSweepWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env   *testsuite.TestWorkflowEnvironment
	stubs *sweepStubs
}

func (s *TemplateDryRunSweepWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
	s.stubs = &sweepStubs{}
	stubs := s.stubs

	s.env.RegisterActivityWithOptions(
		func(_ context.Context) (*activities.ListPublishedTemplatesWithFixturesResult, error) {
			return stubs.listResult, stubs.listErr
		},
		activity.RegisterOptions{Name: activities.ActivityListPublishedTemplatesWithFixtures},
	)

	s.env.RegisterActivityWithOptions(
		func(_ context.Context, in activities.TriggerTemplateDryRunInput) (*activities.TriggerTemplateDryRunResult, error) {
			stubs.triggered = append(stubs.triggered, in)
			if stubs.triggerFn != nil {
				return stubs.triggerFn(in)
			}
			return &activities.TriggerTemplateDryRunResult{RunID: "run-" + in.FixtureID, WorkflowID: "wf-" + in.FixtureID}, nil
		},
		activity.RegisterOptions{Name: activities.ActivityTriggerTemplateDryRun},
	)
}

func TestTemplateDryRunSweepWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(TemplateDryRunSweepWorkflowTestSuite))
}

func candidate(defID string, fixtures ...activities.SweepFixture) activities.SweepTemplateCandidate {
	return activities.SweepTemplateCandidate{
		DefinitionID:     defID,
		Name:             "Template " + defID,
		WorkspaceID:      "ws-1",
		CurrentVersionID: "ver-" + defID,
		Fixtures:         fixtures,
	}
}

func (s *TemplateDryRunSweepWorkflowTestSuite) result() *TemplateDryRunSweepWorkflowResult {
	s.Require().True(s.env.IsWorkflowCompleted())
	s.Require().NoError(s.env.GetWorkflowError())
	var res *TemplateDryRunSweepWorkflowResult
	s.Require().NoError(s.env.GetWorkflowResult(&res))
	return res
}

func (s *TemplateDryRunSweepWorkflowTestSuite) TestTriggersOneDryRunPerFixtureAcrossTemplates() {
	s.stubs.listResult = &activities.ListPublishedTemplatesWithFixturesResult{
		Templates: []activities.SweepTemplateCandidate{
			candidate("def-1",
				activities.SweepFixture{ID: "fix-1", Name: "Basic"},
				activities.SweepFixture{ID: "fix-2", Name: "Advanced"},
			),
			candidate("def-2", activities.SweepFixture{ID: "fix-3", Name: "Only"}),
		},
	}

	s.env.ExecuteWorkflow(TemplateDryRunSweepWorkflow, TemplateDryRunSweepWorkflowInput{})
	res := s.result()

	s.Require().Len(s.stubs.triggered, 3, "one TriggerTemplateDryRun call per fixture")
	s.Equal(3, res.TriggeredCount)
	s.Equal(0, res.SkippedNoFixturesCount)

	byFixture := map[string]activities.TriggerTemplateDryRunInput{}
	for _, t := range s.stubs.triggered {
		byFixture[t.FixtureID] = t
	}
	s.Require().Contains(byFixture, "fix-1")
	s.Equal("def-1", byFixture["fix-1"].DefinitionID)
	s.Equal("ver-def-1", byFixture["fix-1"].CurrentVersionID)
	s.Require().Contains(byFixture, "fix-3")
	s.Equal("def-2", byFixture["fix-3"].DefinitionID)
}

func (s *TemplateDryRunSweepWorkflowTestSuite) TestTemplateWithNoFixturesIsLoggedNotSkippedSilently() {
	s.stubs.listResult = &activities.ListPublishedTemplatesWithFixturesResult{
		Templates: []activities.SweepTemplateCandidate{
			candidate("def-no-fixtures"),
			candidate("def-1", activities.SweepFixture{ID: "fix-1", Name: "Basic"}),
		},
	}

	s.env.ExecuteWorkflow(TemplateDryRunSweepWorkflow, TemplateDryRunSweepWorkflowInput{})
	res := s.result()

	s.Require().Len(s.stubs.triggered, 1, "only the fixtured template is triggered")
	s.Equal(1, res.TriggeredCount)
	s.Equal(1, res.SkippedNoFixturesCount)
	s.Require().Len(res.SkippedDefinitionIDs, 1)
	s.Equal("def-no-fixtures", res.SkippedDefinitionIDs[0])
}

func (s *TemplateDryRunSweepWorkflowTestSuite) TestNoPublishedTemplatesTriggersNothing() {
	s.stubs.listResult = &activities.ListPublishedTemplatesWithFixturesResult{}

	s.env.ExecuteWorkflow(TemplateDryRunSweepWorkflow, TemplateDryRunSweepWorkflowInput{})
	res := s.result()

	s.Empty(s.stubs.triggered)
	s.Equal(0, res.TriggeredCount)
	s.Equal(0, res.SkippedNoFixturesCount)
}

func (s *TemplateDryRunSweepWorkflowTestSuite) TestAFailedTriggerForOneFixtureDoesNotStopOthers() {
	s.stubs.listResult = &activities.ListPublishedTemplatesWithFixturesResult{
		Templates: []activities.SweepTemplateCandidate{
			candidate("def-1",
				activities.SweepFixture{ID: "fix-bad", Name: "Bad"},
				activities.SweepFixture{ID: "fix-good", Name: "Good"},
			),
		},
	}
	s.stubs.triggerFn = func(in activities.TriggerTemplateDryRunInput) (*activities.TriggerTemplateDryRunResult, error) {
		if in.FixtureID == "fix-bad" {
			return nil, assertAnError{}
		}
		return &activities.TriggerTemplateDryRunResult{RunID: "run-good"}, nil
	}

	s.env.ExecuteWorkflow(TemplateDryRunSweepWorkflow, TemplateDryRunSweepWorkflowInput{})
	res := s.result()

	seenFixtures := map[string]bool{}
	for _, t := range s.stubs.triggered {
		seenFixtures[t.FixtureID] = true
	}
	s.Require().Len(seenFixtures, 2, "both fixtures must be attempted; fix-bad retrying must not stop fix-good")
	s.True(seenFixtures["fix-bad"])
	s.True(seenFixtures["fix-good"])
	s.Equal(1, res.TriggeredCount)
	s.Equal(1, res.FailedCount)
}

type assertAnError struct{}

func (assertAnError) Error() string { return "trigger failed" }
