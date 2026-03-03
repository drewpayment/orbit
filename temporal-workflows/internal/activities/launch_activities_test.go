package activities

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// mockPayloadLaunchClient implements PayloadLaunchClient for testing.
type mockPayloadLaunchClient struct {
	updateStatusCalledWith struct {
		launchID string
		status   string
		errMsg   string
	}
	storeOutputsCalledWith struct {
		launchID string
		outputs  map[string]interface{}
	}
	getCredentialsCalledWith struct {
		cloudAccountID string
	}
	updateStatusErr     error
	storeOutputsErr     error
	getCredentialsErr   error
	getCredentialsResult map[string]interface{}
}

func (m *mockPayloadLaunchClient) UpdateLaunchStatus(_ context.Context, launchID, status, errMsg string) error {
	m.updateStatusCalledWith.launchID = launchID
	m.updateStatusCalledWith.status = status
	m.updateStatusCalledWith.errMsg = errMsg
	return m.updateStatusErr
}

func (m *mockPayloadLaunchClient) StoreLaunchOutputs(_ context.Context, launchID string, outputs map[string]interface{}) error {
	m.storeOutputsCalledWith.launchID = launchID
	m.storeOutputsCalledWith.outputs = outputs
	return m.storeOutputsErr
}

func (m *mockPayloadLaunchClient) GetCloudAccountCredentials(_ context.Context, cloudAccountID string) (map[string]interface{}, error) {
	m.getCredentialsCalledWith.cloudAccountID = cloudAccountID
	return m.getCredentialsResult, m.getCredentialsErr
}

// validLaunchInput returns a fully populated input for testing.
func validLaunchInput() types.LaunchWorkflowInput {
	return types.LaunchWorkflowInput{
		LaunchID:          "launch-001",
		TemplateSlug:      "s3-bucket",
		CloudAccountID:    "cloud-acct-1",
		Provider:          "aws",
		Region:            "us-east-1",
		Parameters:        map[string]interface{}{"bucketName": "my-bucket"},
		ApprovalRequired:  false,
		PulumiProjectPath: "templates/aws-s3-bucket",
		WorkspaceID:       "ws-001",
	}
}

func TestValidateLaunchInputs_Success(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	err := activities.ValidateLaunchInputs(context.Background(), validLaunchInput())
	require.NoError(t, err)
}

func TestValidateLaunchInputs_MissingLaunchID(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	input := validLaunchInput()
	input.LaunchID = ""

	err := activities.ValidateLaunchInputs(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "launchId")
}

func TestValidateLaunchInputs_MissingTemplateSlug(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	input := validLaunchInput()
	input.TemplateSlug = ""

	err := activities.ValidateLaunchInputs(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "templateSlug")
}

func TestValidateLaunchInputs_MissingCloudAccountID(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	input := validLaunchInput()
	input.CloudAccountID = ""

	err := activities.ValidateLaunchInputs(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "cloudAccountId")
}

func TestValidateLaunchInputs_MissingProvider(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	input := validLaunchInput()
	input.Provider = ""

	err := activities.ValidateLaunchInputs(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "provider")
}

func TestValidateLaunchInputs_MissingRegion(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	input := validLaunchInput()
	input.Region = ""

	err := activities.ValidateLaunchInputs(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "region")
}

func TestValidateLaunchInputs_MissingPulumiProjectPath(t *testing.T) {
	activities := NewLaunchActivities(nil, slog.Default())
	input := validLaunchInput()
	input.PulumiProjectPath = ""

	err := activities.ValidateLaunchInputs(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "pulumiProjectPath")
}

func TestUpdateLaunchStatus_Success(t *testing.T) {
	mockClient := &mockPayloadLaunchClient{}
	activities := NewLaunchActivities(mockClient, slog.Default())

	input := types.UpdateLaunchStatusInput{
		LaunchID: "launch-001",
		Status:   "active",
		Error:    "",
	}

	err := activities.UpdateLaunchStatus(context.Background(), input)
	require.NoError(t, err)
	require.Equal(t, "launch-001", mockClient.updateStatusCalledWith.launchID)
	require.Equal(t, "active", mockClient.updateStatusCalledWith.status)
	require.Equal(t, "", mockClient.updateStatusCalledWith.errMsg)
}

func TestUpdateLaunchStatus_WithError(t *testing.T) {
	mockClient := &mockPayloadLaunchClient{}
	activities := NewLaunchActivities(mockClient, slog.Default())

	input := types.UpdateLaunchStatusInput{
		LaunchID: "launch-001",
		Status:   "failed",
		Error:    "provisioning timed out",
	}

	err := activities.UpdateLaunchStatus(context.Background(), input)
	require.NoError(t, err)
	require.Equal(t, "failed", mockClient.updateStatusCalledWith.status)
	require.Equal(t, "provisioning timed out", mockClient.updateStatusCalledWith.errMsg)
}

func TestStoreLaunchOutputs_Success(t *testing.T) {
	mockClient := &mockPayloadLaunchClient{}
	activities := NewLaunchActivities(mockClient, slog.Default())

	outputs := map[string]interface{}{
		"bucketArn":  "arn:aws:s3:::my-bucket",
		"bucketName": "my-bucket",
	}
	input := types.StoreLaunchOutputsInput{
		LaunchID: "launch-001",
		Outputs:  outputs,
	}

	err := activities.StoreLaunchOutputs(context.Background(), input)
	require.NoError(t, err)
	require.Equal(t, "launch-001", mockClient.storeOutputsCalledWith.launchID)
	require.Equal(t, outputs, mockClient.storeOutputsCalledWith.outputs)
}

func TestNewLaunchActivities_NilLogger(t *testing.T) {
	activities := NewLaunchActivities(nil, nil)
	require.NotNil(t, activities)
	// Should use slog.Default() when nil is passed
	require.NotNil(t, activities.logger)
}
