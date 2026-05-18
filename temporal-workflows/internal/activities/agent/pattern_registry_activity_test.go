package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakePatternsClient struct {
	listed         []services.PatternDoc
	listErr        error
	listedCategory string

	registered    services.RegisterPendingPatternInput
	registerID    string
	registerErr   error

	resolved       bool
	resolveErr     error
	resolvedID     string
	resolvedEdits  *services.PatternEdits
	resolvedReason string
	resolvedBy     string
}

func (f *fakePatternsClient) ListApproved(_ context.Context, category string) ([]services.PatternDoc, error) {
	f.listedCategory = category
	return f.listed, f.listErr
}
func (f *fakePatternsClient) RegisterPending(_ context.Context, in services.RegisterPendingPatternInput) (string, error) {
	f.registered = in
	return f.registerID, f.registerErr
}
func (f *fakePatternsClient) Resolve(_ context.Context, id string, _ bool, resolvedBy, reason string, edits *services.PatternEdits) (services.ResolvePatternResult, error) {
	f.resolved = true
	f.resolvedID = id
	f.resolvedEdits = edits
	f.resolvedReason = reason
	f.resolvedBy = resolvedBy
	if f.resolveErr != nil {
		return services.ResolvePatternResult{}, f.resolveErr
	}
	return services.ResolvePatternResult{ID: id, Status: "approved"}, nil
}

func TestListApprovedPatterns_PassThrough(t *testing.T) {
	fc := &fakePatternsClient{
		listed: []services.PatternDoc{
			{ID: "1", Name: "static_site_render", DisplayName: "Static site on Render", Category: "static-site", TemplateKind: "shell", TemplateJSON: `{"command":"render deploy"}`, InputSchemaJSON: `{"type":"object"}`, CurrentVersion: 2},
		},
	}
	a := NewPatternRegistryActivities(fc, nil)
	res, err := a.ListApprovedPatterns(context.Background(), ListApprovedPatternsInput{Category: "static-site"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Patterns) != 1 || res.Patterns[0].Name != "static_site_render" {
		t.Errorf("patterns = %+v", res.Patterns)
	}
	if res.Patterns[0].DisplayName != "Static site on Render" || res.Patterns[0].CurrentVersion != 2 {
		t.Errorf("display/version mismatch: %+v", res.Patterns[0])
	}
	if fc.listedCategory != "static-site" {
		t.Errorf("category filter not propagated, got %q", fc.listedCategory)
	}
}

func TestRegisterPendingPattern_NameTakenIsNonRetryable(t *testing.T) {
	fc := &fakePatternsClient{registerErr: services.ErrPatternNameTaken}
	a := NewPatternRegistryActivities(fc, nil)
	_, err := a.RegisterPendingPattern(context.Background(), RegisterPendingPatternInput{
		Name: "x", DisplayName: "X", Category: "compute",
		TemplateKind: "shell", TemplateJSON: `{"command":"true"}`, InputSchemaJSON: `{"type":"object"}`,
	})
	if err == nil {
		t.Fatal("expected error")
	}
	// temporal.NewNonRetryableApplicationError wraps; we check that the
	// original error message survives.
	if err.Error() == "" {
		t.Fatalf("expected non-empty error, got %v", err)
	}
}

func TestRegisterPendingPattern_ValidatesInputs(t *testing.T) {
	a := NewPatternRegistryActivities(&fakePatternsClient{}, nil)
	cases := []RegisterPendingPatternInput{
		{}, // empty
		{Name: "x"},
		{Name: "x", DisplayName: "X"},
		{Name: "x", DisplayName: "X", Category: "compute"},
		{Name: "x", DisplayName: "X", Category: "compute", TemplateKind: "shell"},
		{Name: "x", DisplayName: "X", Category: "compute", TemplateKind: "shell", TemplateJSON: `{"command":"true"}`}, // missing inputSchemaJson
	}
	for i, c := range cases {
		_, err := a.RegisterPendingPattern(context.Background(), c)
		if err == nil {
			t.Errorf("case %d: expected validation error for %+v", i, c)
		}
	}
}

func TestRegisterPendingPattern_PassesAllFields(t *testing.T) {
	fc := &fakePatternsClient{registerID: "pat-abc"}
	a := NewPatternRegistryActivities(fc, nil)
	res, err := a.RegisterPendingPattern(context.Background(), RegisterPendingPatternInput{
		Name: "n", DisplayName: "Display", Description: "d", Category: "compute",
		TemplateKind: "shell", TemplateJSON: `{"command":"true"}`, InputSchemaJSON: `{"type":"object"}`,
		Reasoning: "because", CreatedByRunID: "agent-1", CreatedByUser: "user-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "pat-abc" {
		t.Errorf("id = %q", res.ID)
	}
	if fc.registered.DisplayName != "Display" || fc.registered.Category != "compute" {
		t.Errorf("display/category not propagated: %+v", fc.registered)
	}
	if fc.registered.CreatedByUser != "user-1" || fc.registered.CreatedByRunID != "agent-1" {
		t.Errorf("createdBy fields not propagated: %+v", fc.registered)
	}
}

func TestResolvePattern_PassesEditsToClient(t *testing.T) {
	fc := &fakePatternsClient{}
	a := NewPatternRegistryActivities(fc, nil)
	_, err := a.ResolvePattern(context.Background(), ResolvePatternInput{
		ID: "pat-1", Approved: true, ResolvedBy: "u1", Reason: "lgtm",
		Edited:             true,
		EditedDisplayName:  "Edited Display",
		EditedCategory:     "data",
		EditedTemplateJSON: `{"command":"new"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !fc.resolved || fc.resolvedID != "pat-1" {
		t.Errorf("client.Resolve not called correctly; resolvedID=%q", fc.resolvedID)
	}
	if fc.resolvedEdits == nil {
		t.Fatal("edits not passed through")
	}
	if fc.resolvedEdits.DisplayName != "Edited Display" || fc.resolvedEdits.Category != "data" {
		t.Errorf("edits missing pattern-specific fields: %+v", fc.resolvedEdits)
	}
	if fc.resolvedEdits.TemplateJSON != `{"command":"new"}` {
		t.Errorf("template edit not passed: %q", fc.resolvedEdits.TemplateJSON)
	}
}

func TestResolvePattern_NoEditsMeansNilPayload(t *testing.T) {
	fc := &fakePatternsClient{}
	a := NewPatternRegistryActivities(fc, nil)
	_, err := a.ResolvePattern(context.Background(), ResolvePatternInput{
		ID: "pat-1", Approved: false, Reason: "nope",
	})
	if err != nil {
		t.Fatal(err)
	}
	if fc.resolvedEdits != nil {
		t.Errorf("expected nil edits, got %+v", fc.resolvedEdits)
	}
}

func TestResolvePattern_MissingIDIsNonRetryable(t *testing.T) {
	a := NewPatternRegistryActivities(&fakePatternsClient{}, nil)
	_, err := a.ResolvePattern(context.Background(), ResolvePatternInput{Approved: true})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestResolvePattern_PropagatesClientError(t *testing.T) {
	fc := &fakePatternsClient{resolveErr: errors.New("422 bad json")}
	a := NewPatternRegistryActivities(fc, nil)
	_, err := a.ResolvePattern(context.Background(), ResolvePatternInput{ID: "pat-1", Approved: true})
	if err == nil || err.Error() != "422 bad json" {
		t.Fatalf("expected propagated error, got %v", err)
	}
}
