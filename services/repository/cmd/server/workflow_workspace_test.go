package main

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	commonpb "go.temporal.io/api/common/v1"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/api/serviceerror"
	workflowpb "go.temporal.io/api/workflow/v1"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/mocks"

	grpcserver "github.com/drewpayment/orbit/services/repository/internal/grpc"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

func memoPayload(t *testing.T, v any) *commonpb.Payload {
	t.Helper()
	p, err := converter.GetDefaultDataConverter().ToPayload(v)
	require.NoError(t, err)
	return p
}

func describeWithMemo(fields map[string]*commonpb.Payload) *workflowservice.DescribeWorkflowExecutionResponse {
	return &workflowservice.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &workflowpb.WorkflowExecutionInfo{
			Memo: &commonpb.Memo{Fields: fields},
		},
	}
}

func historyStartedWith(t *testing.T, input any) *mocks.HistoryEventIterator {
	t.Helper()
	payloads, err := converter.GetDefaultDataConverter().ToPayloads(input)
	require.NoError(t, err)
	event := &historypb.HistoryEvent{
		EventType: enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED,
		Attributes: &historypb.HistoryEvent_WorkflowExecutionStartedEventAttributes{
			WorkflowExecutionStartedEventAttributes: &historypb.WorkflowExecutionStartedEventAttributes{Input: payloads},
		},
	}
	iter := &mocks.HistoryEventIterator{}
	iter.On("HasNext").Return(true).Once()
	iter.On("Next").Return(event, nil).Once()
	return iter
}

func TestWorkflowWorkspace(t *testing.T) {
	ctx := context.Background()

	t.Run("memo is authoritative and the history is not read", func(t *testing.T) {
		c := &mocks.Client{}
		c.On("DescribeWorkflowExecution", mock.Anything, "launch-1", "").
			Return(describeWithMemo(map[string]*commonpb.Payload{"workspaceId": memoPayload(t, "ws-1")}), nil)

		got, err := (&TemporalClient{client: c}).WorkflowWorkspace(ctx, "launch-1")

		require.NoError(t, err)
		assert.Equal(t, "ws-1", got)
		c.AssertNotCalled(t, "GetWorkflowHistory", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("workflow started before the memo falls back to its start input", func(t *testing.T) {
		c := &mocks.Client{}
		c.On("DescribeWorkflowExecution", mock.Anything, "launch-1", "").Return(describeWithMemo(nil), nil)
		c.On("GetWorkflowHistory", mock.Anything, "launch-1", "", false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT).
			Return(historyStartedWith(t, types.LaunchWorkflowInput{LaunchID: "l", WorkspaceID: "ws-legacy"}))

		got, err := (&TemporalClient{client: c}).WorkflowWorkspace(ctx, "launch-1")

		require.NoError(t, err)
		assert.Equal(t, "ws-legacy", got)
	})

	t.Run("no memo and no workspace in the input yields an unknown owner", func(t *testing.T) {
		c := &mocks.Client{}
		c.On("DescribeWorkflowExecution", mock.Anything, "launch-1", "").Return(describeWithMemo(nil), nil)
		c.On("GetWorkflowHistory", mock.Anything, "launch-1", "", false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT).
			Return(historyStartedWith(t, map[string]string{"other": "x"}))

		got, err := (&TemporalClient{client: c}).WorkflowWorkspace(ctx, "launch-1")

		require.NoError(t, err)
		assert.Equal(t, "", got)
	})

	t.Run("unknown workflow maps to ErrWorkflowNotFound", func(t *testing.T) {
		c := &mocks.Client{}
		c.On("DescribeWorkflowExecution", mock.Anything, "launch-1", "").
			Return(nil, serviceerror.NewNotFound("nope"))

		_, err := (&TemporalClient{client: c}).WorkflowWorkspace(ctx, "launch-1")

		assert.ErrorIs(t, err, grpcserver.ErrWorkflowNotFound)
	})

	t.Run("describe failure is surfaced, not treated as an unknown owner", func(t *testing.T) {
		c := &mocks.Client{}
		c.On("DescribeWorkflowExecution", mock.Anything, "launch-1", "").Return(nil, errors.New("temporal down"))

		_, err := (&TemporalClient{client: c}).WorkflowWorkspace(ctx, "launch-1")

		require.Error(t, err)
		assert.NotErrorIs(t, err, grpcserver.ErrWorkflowNotFound)
	})
}
