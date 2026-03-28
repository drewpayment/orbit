// T044 Temporal Workflows gRPC Server Implementation
// This file implements the gRPC server for temporal workflow operations

package grpc

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// Request/Response types for Temporal Workflow operations

type StartWorkflowRequest struct {
	WorkflowType string                 `json:"workflow_type"`
	WorkflowID   string                 `json:"workflow_id,omitempty"`
	TaskQueue    string                 `json:"task_queue"`
	Input        map[string]interface{} `json:"input,omitempty"`
	Options      *WorkflowOptions       `json:"options,omitempty"`
}

type StartWorkflowResponse struct {
	Success     bool   `json:"success"`
	Message     string `json:"message"`
	WorkflowID  string `json:"workflow_id"`
	RunID       string `json:"run_id"`
	WorkflowURL string `json:"workflow_url,omitempty"`
}

type GetWorkflowStatusRequest struct {
	WorkflowID string `json:"workflow_id"`
	RunID      string `json:"run_id,omitempty"`
}

type GetWorkflowStatusResponse struct {
	Success    bool                   `json:"success"`
	Message    string                 `json:"message"`
	WorkflowID string                 `json:"workflow_id"`
	RunID      string                 `json:"run_id"`
	Status     string                 `json:"status"`
	StartTime  string                 `json:"start_time"`
	EndTime    string                 `json:"end_time,omitempty"`
	Result     map[string]interface{} `json:"result,omitempty"`
	Error      string                 `json:"error,omitempty"`
}

type ListWorkflowsRequest struct {
	WorkspaceID  string            `json:"workspace_id,omitempty"`
	WorkflowType string            `json:"workflow_type,omitempty"`
	Status       string            `json:"status,omitempty"`
	StartTime    string            `json:"start_time,omitempty"`
	EndTime      string            `json:"end_time,omitempty"`
	Limit        int32             `json:"limit,omitempty"`
	Offset       int32             `json:"offset,omitempty"`
	Filters      map[string]string `json:"filters,omitempty"`
}

type ListWorkflowsResponse struct {
	Success    bool                     `json:"success"`
	Message    string                   `json:"message"`
	Workflows  []*WorkflowExecutionInfo `json:"workflows"`
	TotalCount int64                    `json:"total_count"`
	Page       int32                    `json:"page"`
	PageSize   int32                    `json:"page_size"`
}

type CancelWorkflowRequest struct {
	WorkflowID string `json:"workflow_id"`
	RunID      string `json:"run_id,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

type CancelWorkflowResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type TerminateWorkflowRequest struct {
	WorkflowID string `json:"workflow_id"`
	RunID      string `json:"run_id,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

type TerminateWorkflowResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type SignalWorkflowRequest struct {
	WorkflowID string                 `json:"workflow_id"`
	RunID      string                 `json:"run_id,omitempty"`
	SignalName string                 `json:"signal_name"`
	Input      map[string]interface{} `json:"input,omitempty"`
}

type SignalWorkflowResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type QueryWorkflowRequest struct {
	WorkflowID string                 `json:"workflow_id"`
	RunID      string                 `json:"run_id,omitempty"`
	QueryType  string                 `json:"query_type"`
	Args       map[string]interface{} `json:"args,omitempty"`
}

type QueryWorkflowResponse struct {
	Success bool                   `json:"success"`
	Message string                 `json:"message"`
	Result  map[string]interface{} `json:"result,omitempty"`
}

// Supporting types
type WorkflowOptions struct {
	WorkflowExecutionTimeout string            `json:"workflow_execution_timeout,omitempty"`
	WorkflowRunTimeout       string            `json:"workflow_run_timeout,omitempty"`
	WorkflowTaskTimeout      string            `json:"workflow_task_timeout,omitempty"`
	RetryPolicy              *RetryPolicy      `json:"retry_policy,omitempty"`
	CronSchedule             string            `json:"cron_schedule,omitempty"`
	Memo                     map[string]string `json:"memo,omitempty"`
	SearchAttributes         map[string]string `json:"search_attributes,omitempty"`
}

type RetryPolicy struct {
	InitialInterval        string   `json:"initial_interval,omitempty"`
	BackoffCoefficient     float64  `json:"backoff_coefficient,omitempty"`
	MaximumInterval        string   `json:"maximum_interval,omitempty"`
	MaximumAttempts        int32    `json:"maximum_attempts,omitempty"`
	NonRetriableErrorTypes []string `json:"non_retriable_error_types,omitempty"`
}

type WorkflowExecutionInfo struct {
	WorkflowID    string                 `json:"workflow_id"`
	RunID         string                 `json:"run_id"`
	WorkflowType  string                 `json:"workflow_type"`
	TaskQueue     string                 `json:"task_queue"`
	Status        string                 `json:"status"`
	StartTime     string                 `json:"start_time"`
	EndTime       string                 `json:"end_time,omitempty"`
	ExecutionTime string                 `json:"execution_time"`
	Memo          map[string]string      `json:"memo,omitempty"`
	Result        map[string]interface{} `json:"result,omitempty"`
	Error         string                 `json:"error,omitempty"`
}

// TemporalServer handles temporal workflow gRPC operations
type TemporalServer struct {
	temporalClient client.Client
	logger         *slog.Logger
}

// NewTemporalServer creates a new temporal workflows gRPC server
func NewTemporalServer(temporalClient client.Client, logger *slog.Logger) *TemporalServer {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemporalServer{
		temporalClient: temporalClient,
		logger:         logger,
	}
}

// StartWorkflow starts a new temporal workflow
func (s *TemporalServer) StartWorkflow(ctx context.Context, req *StartWorkflowRequest) (*StartWorkflowResponse, error) {
	s.logger.Info("Starting workflow", "type", req.WorkflowType, "task_queue", req.TaskQueue)

	if req.WorkflowType == "" || req.TaskQueue == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workflow type and task queue are required")
	}

	workflowID := req.WorkflowID
	if workflowID == "" {
		workflowID = fmt.Sprintf("%s-%s", req.WorkflowType, uuid.New().String()[:8])
	}

	opts := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: req.TaskQueue,
	}

	if req.Options != nil {
		if d, err := time.ParseDuration(req.Options.WorkflowExecutionTimeout); err == nil {
			opts.WorkflowExecutionTimeout = d
		}
		if d, err := time.ParseDuration(req.Options.WorkflowRunTimeout); err == nil {
			opts.WorkflowRunTimeout = d
		}
		if d, err := time.ParseDuration(req.Options.WorkflowTaskTimeout); err == nil {
			opts.WorkflowTaskTimeout = d
		}
	}

	we, err := s.temporalClient.ExecuteWorkflow(ctx, opts, req.WorkflowType, req.Input)
	if err != nil {
		s.logger.Error("Failed to start workflow", "workflow_id", workflowID, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to start workflow: %v", err)
	}

	return &StartWorkflowResponse{
		Success:    true,
		Message:    "Workflow started successfully",
		WorkflowID: we.GetID(),
		RunID:      we.GetRunID(),
	}, nil
}

// GetWorkflowStatus retrieves the status of a workflow
func (s *TemporalServer) GetWorkflowStatus(ctx context.Context, req *GetWorkflowStatusRequest) (*GetWorkflowStatusResponse, error) {
	s.logger.Info("Getting workflow status", "workflow_id", req.WorkflowID)

	if req.WorkflowID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workflow ID is required")
	}

	desc, err := s.temporalClient.DescribeWorkflowExecution(ctx, req.WorkflowID, req.RunID)
	if err != nil {
		s.logger.Error("Failed to describe workflow", "workflow_id", req.WorkflowID, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to get workflow status: %v", err)
	}

	info := desc.WorkflowExecutionInfo
	resp := &GetWorkflowStatusResponse{
		Success:    true,
		Message:    "Workflow status retrieved",
		WorkflowID: req.WorkflowID,
		RunID:      info.Execution.RunId,
		Status:     info.Status.String(),
		Result:     make(map[string]interface{}),
	}

	if info.StartTime != nil {
		resp.StartTime = info.StartTime.Format(time.RFC3339)
	}
	if info.CloseTime != nil {
		resp.EndTime = info.CloseTime.Format(time.RFC3339)
	}

	return resp, nil
}

// ListWorkflows lists workflows with filtering
func (s *TemporalServer) ListWorkflows(ctx context.Context, req *ListWorkflowsRequest) (*ListWorkflowsResponse, error) {
	s.logger.Info("Listing workflows")

	pageSize := req.Limit
	if pageSize <= 0 {
		pageSize = 20
	}

	query := ""
	if req.WorkflowType != "" {
		query = fmt.Sprintf("WorkflowType = '%s'", req.WorkflowType)
	}
	if req.Status != "" {
		if query != "" {
			query += " AND "
		}
		query += fmt.Sprintf("ExecutionStatus = '%s'", req.Status)
	}

	listReq := &workflowservice.ListWorkflowExecutionsRequest{
		PageSize: pageSize,
		Query:    query,
	}

	resp, err := s.temporalClient.ListWorkflow(ctx, listReq)
	if err != nil {
		s.logger.Error("Failed to list workflows", "error", err)
		return nil, status.Errorf(codes.Internal, "failed to list workflows: %v", err)
	}

	workflows := make([]*WorkflowExecutionInfo, 0, len(resp.Executions))
	for _, exec := range resp.Executions {
		wf := &WorkflowExecutionInfo{
			WorkflowID:   exec.Execution.WorkflowId,
			RunID:        exec.Execution.RunId,
			WorkflowType: exec.Type.Name,
			TaskQueue:    exec.TaskQueue,
			Status:       exec.Status.String(),
		}
		if exec.StartTime != nil {
			wf.StartTime = exec.StartTime.Format(time.RFC3339)
		}
		if exec.CloseTime != nil {
			wf.EndTime = exec.CloseTime.Format(time.RFC3339)
		}
		workflows = append(workflows, wf)
	}

	return &ListWorkflowsResponse{
		Success:    true,
		Message:    "Workflows listed successfully",
		Workflows:  workflows,
		TotalCount: int64(len(workflows)),
		Page:       1,
		PageSize:   pageSize,
	}, nil
}

// CancelWorkflow cancels a running workflow
func (s *TemporalServer) CancelWorkflow(ctx context.Context, req *CancelWorkflowRequest) (*CancelWorkflowResponse, error) {
	s.logger.Info("Cancelling workflow", "workflow_id", req.WorkflowID)

	if req.WorkflowID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workflow ID is required")
	}

	err := s.temporalClient.CancelWorkflow(ctx, req.WorkflowID, req.RunID)
	if err != nil {
		s.logger.Error("Failed to cancel workflow", "workflow_id", req.WorkflowID, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to cancel workflow: %v", err)
	}

	return &CancelWorkflowResponse{
		Success: true,
		Message: fmt.Sprintf("Workflow %s cancellation requested", req.WorkflowID),
	}, nil
}

// TerminateWorkflow terminates a workflow
func (s *TemporalServer) TerminateWorkflow(ctx context.Context, req *TerminateWorkflowRequest) (*TerminateWorkflowResponse, error) {
	s.logger.Info("Terminating workflow", "workflow_id", req.WorkflowID)

	if req.WorkflowID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workflow ID is required")
	}

	reason := req.Reason
	if reason == "" {
		reason = "Terminated via API"
	}

	err := s.temporalClient.TerminateWorkflow(ctx, req.WorkflowID, req.RunID, reason)
	if err != nil {
		s.logger.Error("Failed to terminate workflow", "workflow_id", req.WorkflowID, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to terminate workflow: %v", err)
	}

	return &TerminateWorkflowResponse{
		Success: true,
		Message: fmt.Sprintf("Workflow %s terminated", req.WorkflowID),
	}, nil
}

// SignalWorkflow sends a signal to a workflow
func (s *TemporalServer) SignalWorkflow(ctx context.Context, req *SignalWorkflowRequest) (*SignalWorkflowResponse, error) {
	s.logger.Info("Signaling workflow", "workflow_id", req.WorkflowID, "signal", req.SignalName)

	if req.WorkflowID == "" || req.SignalName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workflow ID and signal name are required")
	}

	// Serialize input to JSON for the signal payload
	var signalInput interface{}
	if req.Input != nil {
		signalInput = req.Input
	}

	err := s.temporalClient.SignalWorkflow(ctx, req.WorkflowID, req.RunID, req.SignalName, signalInput)
	if err != nil {
		s.logger.Error("Failed to signal workflow", "workflow_id", req.WorkflowID, "signal", req.SignalName, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to signal workflow: %v", err)
	}

	return &SignalWorkflowResponse{
		Success: true,
		Message: fmt.Sprintf("Signal '%s' sent to workflow %s", req.SignalName, req.WorkflowID),
	}, nil
}

// QueryWorkflow queries a workflow
func (s *TemporalServer) QueryWorkflow(ctx context.Context, req *QueryWorkflowRequest) (*QueryWorkflowResponse, error) {
	s.logger.Info("Querying workflow", "workflow_id", req.WorkflowID, "query_type", req.QueryType)

	if req.WorkflowID == "" || req.QueryType == "" {
		return nil, status.Errorf(codes.InvalidArgument, "workflow ID and query type are required")
	}

	resp, err := s.temporalClient.QueryWorkflow(ctx, req.WorkflowID, req.RunID, req.QueryType, req.Args)
	if err != nil {
		s.logger.Error("Failed to query workflow", "workflow_id", req.WorkflowID, "error", err)
		return nil, status.Errorf(codes.Internal, "failed to query workflow: %v", err)
	}

	var result map[string]interface{}
	if err := resp.Get(&result); err != nil {
		// Try to decode as JSON string
		var jsonStr string
		if err2 := resp.Get(&jsonStr); err2 == nil {
			json.Unmarshal([]byte(jsonStr), &result)
		}
		if result == nil {
			result = make(map[string]interface{})
		}
	}

	return &QueryWorkflowResponse{
		Success: true,
		Message: "Workflow queried successfully",
		Result:  result,
	}, nil
}

// extractUserID extracts user ID from gRPC metadata
func (s *TemporalServer) extractUserID(ctx context.Context) (uuid.UUID, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return uuid.Nil, fmt.Errorf("no metadata in context")
	}

	userIDs := md.Get("user-id")
	if len(userIDs) == 0 {
		return uuid.Nil, fmt.Errorf("user-id not found in metadata")
	}

	return uuid.Parse(userIDs[0])
}

// extractWorkspaceID extracts workspace ID from gRPC metadata
func (s *TemporalServer) extractWorkspaceID(ctx context.Context) (uuid.UUID, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return uuid.Nil, fmt.Errorf("no metadata in context")
	}

	wsIDs := md.Get("workspace-id")
	if len(wsIDs) == 0 {
		return uuid.Nil, fmt.Errorf("workspace-id not found in metadata")
	}

	return uuid.Parse(wsIDs[0])
}

// RegisterServer registers the temporal server with a gRPC server
func (s *TemporalServer) RegisterServer(grpcServer *grpc.Server) {
	// Registration happens in main.go via Connect handlers
	s.logger.Info("Temporal gRPC server registered")
}

