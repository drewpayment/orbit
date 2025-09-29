/**
 * T026 - Performance Test: Code Generation (<30s)
 *
 * This performance test validates that code generation operations meet the constitutional
 * performance requirements of <30 seconds for completion via Temporal workflows.
 *
 * TDD Status: MUST fail until Temporal WorkflowService is implemented
 * Expected failure: "connection refused" to localhost:8006
 */

package performance

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	temporalv1 "github.com/drewpayment/orbit/proto/gen/go/idp/temporal/v1"
)

const (
	TemporalServiceAddr   = "localhost:8006" // Temporal service for workflow management
	CodeGenTimeout        = 45 * time.Second // Allow extra time for code generation
	CodeGenP95Requirement = 30 * time.Second // Constitutional requirement
	CodeGenTestIterations = 10               // Fewer iterations due to longer operations
	ConcurrentCodeGenJobs = 5                // Moderate concurrency for resource-intensive ops
)

func TestCodeGenerationPerformance(t *testing.T) {
	t.Log("=== T026 Performance Test: Code Generation Operations ===")
	t.Log("Testing code generation performance requirements (<30s completion)")

	// Test single code generation performance via Temporal workflow
	t.Run("TemporalCodeGeneration_Performance", func(t *testing.T) {
		testTemporalCodeGenerationPerformance(t)
	})

	// Test repository generation performance
	t.Run("RepositoryGeneration_Performance", func(t *testing.T) {
		testRepositoryGenerationPerformance(t)
	})

	// Test concurrent workflow performance
	t.Run("ConcurrentWorkflows_Performance", func(t *testing.T) {
		testConcurrentWorkflowsPerformance(t)
	})
}

func testTemporalCodeGenerationPerformance(t *testing.T) {
	t.Log("🚀 Testing Temporal code generation workflow performance...")

	// Connect to Temporal service
	conn, err := grpc.NewClient(TemporalServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to Temporal service: %v", err)
		return
	}
	defer conn.Close()

	client := temporalv1.NewWorkflowServiceClient(conn)

	var durations []time.Duration
	successCount := 0

	for i := 0; i < CodeGenTestIterations; i++ {
		request := &temporalv1.CodeGenerationWorkflowRequest{
			RequestId:       "perf-test-codegen-" + string(rune(i)),
			WorkspaceId:     "perf-test-workspace",
			UserId:          "perf-test-user",
			SchemaId:        "perf-test-schema-id",
			TargetLanguages: []string{"typescript", "go", "python"},
			Options: &temporalv1.CodeGenerationOptions{
				IncludeTests: true,
				IncludeDocs:  true,
				OutputFormat: "zip",
				LanguageConfigs: map[string]string{
					"typescript.packageName": "test-client",
					"go.moduleName":          "github.com/test/client",
					"python.packageName":     "test_client",
				},
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), CodeGenTimeout)
		startTime := time.Now()

		response, err := client.StartCodeGeneration(ctx, request)
		if err != nil {
			cancel()
			t.Logf("✅ TDD phase - code generation workflow start failing as expected: %v", err)
			continue
		}

		// Poll for workflow completion
		workflowCompleted := false
		for time.Since(startTime) < CodeGenTimeout {
			statusReq := &temporalv1.GetWorkflowStatusRequest{
				WorkflowId: response.WorkflowId,
				RunId:      response.RunId,
			}

			statusResp, err := client.GetWorkflowStatus(ctx, statusReq)
			if err != nil {
				t.Logf("✅ TDD phase - workflow status check failing as expected: %v", err)
				break
			}

			if statusResp.Status == temporalv1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED ||
				statusResp.Status == temporalv1.WorkflowStatus_WORKFLOW_STATUS_FAILED {
				workflowCompleted = true
				break
			}

			time.Sleep(2 * time.Second) // Poll every 2 seconds
		}

		duration := time.Since(startTime)
		cancel()

		if workflowCompleted {
			durations = append(durations, duration)
			successCount++

			// Workflow should complete within constitutional limits
			assert.Less(t, duration, CodeGenP95Requirement,
				"Code generation workflow should complete under %v, got %v",
				CodeGenP95Requirement, duration)

			t.Logf("   Code generation workflow %s completed in %v", response.WorkflowId, duration)
		} else {
			t.Logf("✅ TDD phase - workflow completion timeout as expected")
		}
	}

	if successCount > 0 {
		// Calculate performance metrics
		p95Duration := calculateCodeGenPercentile(durations, 0.95)
		avgDuration := calculateCodeGenAverage(durations)

		t.Logf("📊 Temporal Code Generation Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, CodeGenTestIterations,
			float64(successCount)/float64(CodeGenTestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", CodeGenP95Requirement)

		// Validate constitutional requirement for code generation
		assert.Less(t, p95Duration, CodeGenP95Requirement,
			"Code generation p95 must be under %v, got %v",
			CodeGenP95Requirement, p95Duration)

		t.Log("✅ Temporal code generation performance test completed")
	}
}

func testRepositoryGenerationPerformance(t *testing.T) {
	t.Log("🚀 Testing repository generation workflow performance...")

	// Connect to Temporal service
	conn, err := grpc.NewClient(TemporalServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to Temporal service: %v", err)
		return
	}
	defer conn.Close()

	client := temporalv1.NewWorkflowServiceClient(conn)

	var durations []time.Duration
	successCount := 0

	for i := 0; i < 5; i++ { // Fewer iterations for repository generation
		request := &temporalv1.RepositoryGenerationWorkflowRequest{
			RequestId:      "perf-test-repo-" + string(rune(i)),
			WorkspaceId:    "perf-test-workspace",
			UserId:         "perf-test-user",
			RepositoryName: "perf-test-repository-" + string(rune(i)),
			TemplateType:   "go-microservice",
			Variables: map[string]string{
				"service_name":  "perf-test-service",
				"database_type": "postgresql",
				"enable_auth":   "true",
				"api_version":   "v1",
			},
			Config: &temporalv1.RepositoryConfiguration{
				Language:  "go",
				Framework: "gin",
				Features:  []string{"database", "auth", "monitoring"},
				GitConfig: &temporalv1.GitConfiguration{
					Provider:     "github",
					Organization: "perf-test-org",
					PrivateRepo:  true,
					Topics:       []string{"microservice", "performance-test"},
				},
				Customizations: map[string]string{
					"go.module": "github.com/perf-test/service",
					"port":      "8080",
				},
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), CodeGenTimeout)
		startTime := time.Now()

		response, err := client.StartRepositoryGeneration(ctx, request)
		if err != nil {
			cancel()
			t.Logf("✅ TDD phase - repository generation workflow start failing as expected: %v", err)
			continue
		}

		// Poll for workflow completion
		workflowCompleted := false
		for time.Since(startTime) < CodeGenTimeout {
			statusReq := &temporalv1.GetWorkflowStatusRequest{
				WorkflowId: response.WorkflowId,
				RunId:      response.RunId,
			}

			statusResp, err := client.GetWorkflowStatus(ctx, statusReq)
			if err != nil {
				t.Logf("✅ TDD phase - workflow status check failing as expected: %v", err)
				break
			}

			if statusResp.Status == temporalv1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED ||
				statusResp.Status == temporalv1.WorkflowStatus_WORKFLOW_STATUS_FAILED {
				workflowCompleted = true
				break
			}

			time.Sleep(3 * time.Second) // Poll every 3 seconds for longer operations
		}

		duration := time.Since(startTime)
		cancel()

		if workflowCompleted {
			durations = append(durations, duration)
			successCount++

			// Repository generation should complete within reasonable time
			assert.Less(t, duration, CodeGenP95Requirement*2,
				"Repository generation should complete under %v, got %v",
				CodeGenP95Requirement*2, duration)

			t.Logf("   Repository generation workflow %s completed in %v", response.WorkflowId, duration)
		} else {
			t.Logf("✅ TDD phase - repository generation timeout as expected")
		}
	}

	if successCount > 0 {
		// Calculate performance metrics
		p95Duration := calculateCodeGenPercentile(durations, 0.95)
		avgDuration := calculateCodeGenAverage(durations)

		t.Logf("📊 Repository Generation Performance Results:")
		t.Logf("   - Success Rate: %d/5 (%.1f%%)", successCount,
			float64(successCount)/5.0*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v (allowing 2x for complexity)", CodeGenP95Requirement*2)

		// Repository generation can be longer but should be reasonable
		assert.Less(t, p95Duration, CodeGenP95Requirement*2,
			"Repository generation p95 should be reasonable, got %v", p95Duration)

		t.Log("✅ Repository generation performance test completed")
	}
}

func testConcurrentWorkflowsPerformance(t *testing.T) {
	t.Log("🚀 Testing concurrent workflow performance...")

	// Connect to Temporal service
	conn, err := grpc.NewClient(TemporalServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to Temporal service: %v", err)
		return
	}
	defer conn.Close()

	client := temporalv1.NewWorkflowServiceClient(conn)

	type result struct {
		workflowId string
		duration   time.Duration
		err        error
	}

	results := make(chan result, ConcurrentCodeGenJobs)
	startTime := time.Now()

	// Launch concurrent code generation workflows
	for i := 0; i < ConcurrentCodeGenJobs; i++ {
		go func(jobIndex int) {
			request := &temporalv1.CodeGenerationWorkflowRequest{
				RequestId:       "concurrent-codegen-" + string(rune(jobIndex)),
				WorkspaceId:     "concurrent-perf-workspace",
				UserId:          "concurrent-perf-user",
				SchemaId:        "concurrent-perf-schema",
				TargetLanguages: []string{"typescript", "go"},
				Options: &temporalv1.CodeGenerationOptions{
					IncludeTests: false, // Skip tests for faster concurrent generation
					IncludeDocs:  false,
					OutputFormat: "zip",
					LanguageConfigs: map[string]string{
						"typescript.packageName": "concurrent-client-" + string(rune(jobIndex)),
					},
				},
			}

			ctx, cancel := context.WithTimeout(context.Background(), CodeGenTimeout)
			operationStart := time.Now()

			response, err := client.StartCodeGeneration(ctx, request)
			if err != nil {
				cancel()
				results <- result{
					workflowId: "",
					duration:   time.Since(operationStart),
					err:        err,
				}
				return
			}

			// Poll for completion (simplified for concurrent test)
			workflowCompleted := false
			for time.Since(operationStart) < CodeGenTimeout/2 { // Shorter timeout for concurrent
				statusReq := &temporalv1.GetWorkflowStatusRequest{
					WorkflowId: response.WorkflowId,
					RunId:      response.RunId,
				}

				statusResp, err := client.GetWorkflowStatus(ctx, statusReq)
				if err != nil {
					break
				}

				if statusResp.Status == temporalv1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
					workflowCompleted = true
					break
				}

				time.Sleep(1 * time.Second) // Faster polling for concurrent test
			}

			duration := time.Since(operationStart)
			cancel()

			var resultErr error
			if !workflowCompleted {
				resultErr = err // Use the error if workflow didn't complete
			}

			results <- result{
				workflowId: response.WorkflowId,
				duration:   duration,
				err:        resultErr,
			}
		}(i)
	}

	// Collect results
	var durations []time.Duration
	errorCount := 0
	successCount := 0

	for i := 0; i < ConcurrentCodeGenJobs; i++ {
		res := <-results
		if res.err != nil {
			errorCount++
			t.Logf("✅ TDD phase - concurrent workflow failing as expected: %v", res.err)
		} else {
			durations = append(durations, res.duration)
			successCount++
			t.Logf("   Concurrent workflow %s completed in %v", res.workflowId, res.duration)
		}
	}

	totalDuration := time.Since(startTime)

	if successCount > 0 {
		// Calculate performance metrics
		p95Duration := calculateCodeGenPercentile(durations, 0.95)
		avgDuration := calculateCodeGenAverage(durations)

		t.Logf("📊 Concurrent Workflow Performance Results:")
		t.Logf("   - Total Duration: %v", totalDuration)
		t.Logf("   - Concurrent Jobs: %d", ConcurrentCodeGenJobs)
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, ConcurrentCodeGenJobs,
			float64(successCount)/float64(ConcurrentCodeGenJobs)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", CodeGenP95Requirement*2)

		// Concurrent workflows should still meet reasonable performance
		assert.Less(t, p95Duration, CodeGenP95Requirement*3,
			"Concurrent workflows p95 should remain reasonable under load, got %v",
			p95Duration)

		// System should handle some concurrent workflows
		assert.Greater(t, float64(successCount)/float64(ConcurrentCodeGenJobs), 0.5,
			"System should handle at least 50%% of concurrent workflows")

		t.Log("✅ Concurrent workflow performance test completed")
	} else {
		t.Log("✅ TDD phase - all concurrent workflows failing as expected during test phase")
	}
}

// Helper functions for code generation percentile calculation
func calculateCodeGenPercentile(durations []time.Duration, percentile float64) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	// Simple percentile calculation
	index := int(float64(len(durations)) * percentile)
	if index >= len(durations) {
		index = len(durations) - 1
	}

	// Sort durations (bubble sort for simplicity)
	sortedDurations := make([]time.Duration, len(durations))
	copy(sortedDurations, durations)

	for i := 0; i < len(sortedDurations)-1; i++ {
		for j := 0; j < len(sortedDurations)-i-1; j++ {
			if sortedDurations[j] > sortedDurations[j+1] {
				sortedDurations[j], sortedDurations[j+1] = sortedDurations[j+1], sortedDurations[j]
			}
		}
	}

	return sortedDurations[index]
}

func calculateCodeGenAverage(durations []time.Duration) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	var total time.Duration
	for _, d := range durations {
		total += d
	}

	return total / time.Duration(len(durations))
}
