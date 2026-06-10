package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakePatternInstanceClient struct {
	getPatternByIDFn func(id string) (services.PatternFull, error)

	created       services.PatternInstanceCreateInput
	createID      string
	createErr     error
	createCalls   int

	updated       services.PatternInstanceStatusInput
	updateID      string
	updateErr     error
	updateCalls   int
}

func (f *fakePatternInstanceClient) GetPatternByID(_ context.Context, id string) (services.PatternFull, error) {
	if f.getPatternByIDFn != nil {
		return f.getPatternByIDFn(id)
	}
	return services.PatternFull{}, nil
}
func (f *fakePatternInstanceClient) CreateInstance(_ context.Context, in services.PatternInstanceCreateInput) (string, error) {
	f.created = in
	f.createCalls++
	if f.createErr != nil {
		return "", f.createErr
	}
	return f.createID, nil
}
func (f *fakePatternInstanceClient) UpdateStatus(_ context.Context, id string, in services.PatternInstanceStatusInput) error {
	f.updated = in
	f.updateID = id
	f.updateCalls++
	return f.updateErr
}

func TestGetPatternByID_NotFoundIsNonRetryable(t *testing.T) {
	fc := &fakePatternInstanceClient{
		getPatternByIDFn: func(_ string) (services.PatternFull, error) {
			return services.PatternFull{}, services.ErrPatternNotFound
		},
	}
	a := NewPatternInstanceActivities(fc, nil)
	_, err := a.GetPatternByID(context.Background(), GetPatternByIDInput{ID: "pat-x"})
	if err == nil || err.Error() == "" {
		t.Fatalf("expected non-retryable not-found error, got %v", err)
	}
}

func TestGetPatternByID_MissingIDRejected(t *testing.T) {
	a := NewPatternInstanceActivities(&fakePatternInstanceClient{}, nil)
	_, err := a.GetPatternByID(context.Background(), GetPatternByIDInput{})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestGetPatternByID_HappyPathPropagatesFields(t *testing.T) {
	fc := &fakePatternInstanceClient{
		getPatternByIDFn: func(id string) (services.PatternFull, error) {
			return services.PatternFull{
				ID: id, Name: "p", DisplayName: "P", Description: "d",
				Category: "compute", TemplateKind: "shell",
				TemplateJSON:    `{"command":"echo {{name}}"}`,
				InputSchemaJSON: `{"type":"object","required":["name"]}`,
				Status:          "approved", CurrentVersion: 3,
			}, nil
		},
	}
	a := NewPatternInstanceActivities(fc, nil)
	res, err := a.GetPatternByID(context.Background(), GetPatternByIDInput{ID: "pat-1"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Pattern.ID != "pat-1" || res.Pattern.TemplateKind != "shell" || res.Pattern.CurrentVersion != 3 {
		t.Errorf("pattern mapping mismatch: %+v", res.Pattern)
	}
}

func TestCreatePatternInstance_NameTakenIsNonRetryable(t *testing.T) {
	fc := &fakePatternInstanceClient{createErr: services.ErrInstanceNameTaken}
	a := NewPatternInstanceActivities(fc, nil)
	_, err := a.CreatePatternInstance(context.Background(), CreatePatternInstanceInput{
		WorkspaceID: "ws", PatternID: "pat", Name: "redis-1",
	})
	if err == nil || err.Error() == "" {
		t.Fatalf("expected non-retryable name-taken error, got %v", err)
	}
}

func TestCreatePatternInstance_ValidatesInputs(t *testing.T) {
	a := NewPatternInstanceActivities(&fakePatternInstanceClient{}, nil)
	cases := []CreatePatternInstanceInput{
		{},
		{WorkspaceID: "ws"},
		{WorkspaceID: "ws", PatternID: "p"},
	}
	for i, c := range cases {
		_, err := a.CreatePatternInstance(context.Background(), c)
		if err == nil {
			t.Errorf("case %d: expected validation error for %+v", i, c)
		}
	}
}

func TestCreatePatternInstance_PassesAllFields(t *testing.T) {
	fc := &fakePatternInstanceClient{createID: "inst-7"}
	a := NewPatternInstanceActivities(fc, nil)
	res, err := a.CreatePatternInstance(context.Background(), CreatePatternInstanceInput{
		WorkspaceID:    "ws-1",
		PatternID:      "pat-1",
		PatternVersion: 2,
		Name:           "inst",
		AppID:          "app-1",
		Parameters:     map[string]interface{}{"name": "demo"},
		CreatedByUser:  "u-1",
		CreatedByRunID: "run-1",
		WorkflowID:     "wf-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ID != "inst-7" {
		t.Errorf("id = %q", res.ID)
	}
	if fc.created.WorkspaceID != "ws-1" || fc.created.PatternVersion != 2 ||
		fc.created.AppID != "app-1" || fc.created.WorkflowID != "wf-1" {
		t.Errorf("create payload mismatch: %+v", fc.created)
	}
}

func TestCreatePatternInstance_NilParametersBecomesEmptyMap(t *testing.T) {
	fc := &fakePatternInstanceClient{createID: "inst-1"}
	a := NewPatternInstanceActivities(fc, nil)
	_, err := a.CreatePatternInstance(context.Background(), CreatePatternInstanceInput{
		WorkspaceID: "ws", PatternID: "p", Name: "i", Parameters: nil,
	})
	if err != nil {
		t.Fatal(err)
	}
	if fc.created.Parameters == nil {
		t.Fatal("nil parameters should become empty map before write")
	}
}

func TestUpdatePatternInstanceStatus_PassesPayload(t *testing.T) {
	fc := &fakePatternInstanceClient{}
	a := NewPatternInstanceActivities(fc, nil)
	err := a.UpdatePatternInstanceStatus(context.Background(), UpdatePatternInstanceStatusInput{
		ID: "inst-1", Status: "active",
		Outputs:      map[string]interface{}{"url": "https://x"},
		ErrorMessage: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	if fc.updateID != "inst-1" || fc.updated.Status != "active" {
		t.Errorf("update payload wrong: id=%q status=%q", fc.updateID, fc.updated.Status)
	}
	if fc.updated.Outputs["url"] != "https://x" {
		t.Errorf("outputs not propagated: %+v", fc.updated.Outputs)
	}
}

func TestUpdatePatternInstanceStatus_ValidatesInputs(t *testing.T) {
	a := NewPatternInstanceActivities(&fakePatternInstanceClient{}, nil)
	if err := a.UpdatePatternInstanceStatus(context.Background(), UpdatePatternInstanceStatusInput{Status: "active"}); err == nil {
		t.Error("expected error for missing id")
	}
	if err := a.UpdatePatternInstanceStatus(context.Background(), UpdatePatternInstanceStatusInput{ID: "x"}); err == nil {
		t.Error("expected error for missing status")
	}
}

func TestUpdatePatternInstanceStatus_PropagatesClientError(t *testing.T) {
	fc := &fakePatternInstanceClient{updateErr: errors.New("422 schema validation")}
	a := NewPatternInstanceActivities(fc, nil)
	err := a.UpdatePatternInstanceStatus(context.Background(), UpdatePatternInstanceStatusInput{
		ID: "x", Status: "failed", ErrorMessage: "boom",
	})
	if err == nil || err.Error() != "422 schema validation" {
		t.Fatalf("expected propagated error, got %v", err)
	}
}
