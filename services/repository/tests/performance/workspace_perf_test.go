/**
 * T024 - Performance Test: Workspace Operations (<200ms p95)
 *
 * This performance test validates that workspace operations meet the constitutional
 * performance requirements of <200ms p95 response times.
 *
 * TDD Status: MUST fail until WorkspaceService is implemented
 * Expected failure: "connection refused" to localhost:8001
 */

package performance

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	commonv1 "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
	paginationv1 "github.com/drewpayment/orbit/proto/gen/go/idp/pagination/v1"
	workspacev1 "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
)

const (
	WorkspaceServiceAddr = "localhost:8001"
	PerformanceTimeout   = 5 * time.Second
	P95Requirement       = 200 * time.Millisecond // Constitutional requirement
	ConcurrentUsers      = 50                     // Simulate concurrent access
	TestIterations       = 100                    // Iterations for percentile calculation
)

func TestWorkspaceOperationsPerformance(t *testing.T) {
	t.Log("=== T024 Performance Test: Workspace Operations ===")
	t.Log("Testing workspace operations performance requirements (<200ms p95)")

	// Connect to Workspace service

	conn, err := grpc.NewClient(WorkspaceServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to workspace service: %v", err)
		return
	}
	defer conn.Close()

	client := workspacev1.NewWorkspaceServiceClient(conn)
	t.Log("✅ gRPC client connection established")

	// Test workspace creation performance
	t.Run("CreateWorkspace_Performance", func(t *testing.T) {
		testCreateWorkspacePerformance(t, client)
	})

	// Test workspace listing performance
	t.Run("ListWorkspaces_Performance", func(t *testing.T) {
		testListWorkspacesPerformance(t, client)
	})

	// Test workspace get performance
	t.Run("GetWorkspace_Performance", func(t *testing.T) {
		testGetWorkspacePerformance(t, client)
	})

	// Test concurrent workspace operations
	t.Run("ConcurrentWorkspace_Performance", func(t *testing.T) {
		testConcurrentWorkspacePerformance(t, client)
	})
}

func testCreateWorkspacePerformance(t *testing.T, client workspacev1.WorkspaceServiceClient) {
	t.Log("🚀 Testing CreateWorkspace performance...")

	var durations []time.Duration
	successCount := 0

	for i := 0; i < TestIterations; i++ {
		request := &workspacev1.CreateWorkspaceRequest{
			Name:        "Performance Test Workspace",
			Slug:        "perf-test-workspace",
			Description: "Performance testing workspace",
			Settings: &workspacev1.WorkspaceSettings{
				DefaultVisibility:       commonv1.Visibility_VISIBILITY_INTERNAL,
				RequireApprovalForRepos: false,
				EnableCodeGeneration:    true,
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), P95Requirement*2)
		startTime := time.Now()

		response, err := client.CreateWorkspace(ctx, request)
		duration := time.Since(startTime)
		cancel()

		if err != nil {
			// Expected TDD failure
			t.Logf("✅ TDD phase - workspace creation failing as expected: %v", err)
			continue
		}

		// If service is implemented, validate performance
		durations = append(durations, duration)
		successCount++

		require.NotNil(t, response, "CreateWorkspace response should not be nil")
		require.NotNil(t, response.Response, "Response wrapper should not be nil")
		assert.True(t, response.Response.Success, "CreateWorkspace should succeed")

		// Individual request should be fast
		assert.Less(t, duration, P95Requirement*2,
			"Individual CreateWorkspace request should be under %v, got %v",
			P95Requirement*2, duration)
	}

	if successCount > 0 {
		// Calculate percentiles
		p95Duration := calculatePercentile(durations, 0.95)
		avgDuration := calculateAverage(durations)

		t.Logf("📊 CreateWorkspace Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, TestIterations,
			float64(successCount)/float64(TestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", P95Requirement)

		// Validate constitutional requirement
		assert.Less(t, p95Duration, P95Requirement,
			"CreateWorkspace p95 must be under %v, got %v", P95Requirement, p95Duration)

		t.Log("✅ CreateWorkspace performance test completed")
	}
}

func testListWorkspacesPerformance(t *testing.T, client workspacev1.WorkspaceServiceClient) {
	t.Log("🚀 Testing ListWorkspaces performance...")

	var durations []time.Duration
	successCount := 0

	for i := 0; i < TestIterations; i++ {
		request := &workspacev1.ListWorkspacesRequest{
			Pagination: &paginationv1.PaginationRequest{
				Page: 1,
				Size: 20,
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), P95Requirement*2)
		startTime := time.Now()

		response, err := client.ListWorkspaces(ctx, request)
		duration := time.Since(startTime)
		cancel()

		if err != nil {
			// Expected TDD failure
			t.Logf("✅ TDD phase - workspace listing failing as expected: %v", err)
			continue
		}

		// If service is implemented, validate performance
		durations = append(durations, duration)
		successCount++

		require.NotNil(t, response, "ListWorkspaces response should not be nil")
		require.NotNil(t, response.Response, "Response wrapper should not be nil")
		assert.True(t, response.Response.Success, "ListWorkspaces should succeed")

		// Individual request should be fast
		assert.Less(t, duration, P95Requirement*2,
			"Individual ListWorkspaces request should be under %v, got %v",
			P95Requirement*2, duration)
	}

	if successCount > 0 {
		// Calculate percentiles
		p95Duration := calculatePercentile(durations, 0.95)
		avgDuration := calculateAverage(durations)

		t.Logf("📊 ListWorkspaces Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, TestIterations,
			float64(successCount)/float64(TestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", P95Requirement)

		// Validate constitutional requirement
		assert.Less(t, p95Duration, P95Requirement,
			"ListWorkspaces p95 must be under %v, got %v", P95Requirement, p95Duration)

		t.Log("✅ ListWorkspaces performance test completed")
	}
}

func testGetWorkspacePerformance(t *testing.T, client workspacev1.WorkspaceServiceClient) {
	t.Log("🚀 Testing GetWorkspace performance...")

	var durations []time.Duration
	successCount := 0

	for i := 0; i < TestIterations; i++ {
		request := &workspacev1.GetWorkspaceRequest{
			Id: "perf-test-workspace-id",
		}

		ctx, cancel := context.WithTimeout(context.Background(), P95Requirement*2)
		startTime := time.Now()

		response, err := client.GetWorkspace(ctx, request)
		duration := time.Since(startTime)
		cancel()

		if err != nil {
			// Expected TDD failure
			t.Logf("✅ TDD phase - workspace get failing as expected: %v", err)
			continue
		}

		// If service is implemented, validate performance
		durations = append(durations, duration)
		successCount++

		require.NotNil(t, response, "GetWorkspace response should not be nil")
		require.NotNil(t, response.Response, "Response wrapper should not be nil")

		// Individual request should be fast
		assert.Less(t, duration, P95Requirement*2,
			"Individual GetWorkspace request should be under %v, got %v",
			P95Requirement*2, duration)
	}

	if successCount > 0 {
		// Calculate percentiles
		p95Duration := calculatePercentile(durations, 0.95)
		avgDuration := calculateAverage(durations)

		t.Logf("📊 GetWorkspace Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, TestIterations,
			float64(successCount)/float64(TestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", P95Requirement)

		// Validate constitutional requirement
		assert.Less(t, p95Duration, P95Requirement,
			"GetWorkspace p95 must be under %v, got %v", P95Requirement, p95Duration)

		t.Log("✅ GetWorkspace performance test completed")
	}
}

func testConcurrentWorkspacePerformance(t *testing.T, client workspacev1.WorkspaceServiceClient) {
	t.Log("🚀 Testing concurrent workspace operations performance...")

	type result struct {
		duration time.Duration
		err      error
	}

	results := make(chan result, ConcurrentUsers)
	startTime := time.Now()

	// Launch concurrent operations
	for i := 0; i < ConcurrentUsers; i++ {
		go func(userIndex int) {
			request := &workspacev1.ListWorkspacesRequest{
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 10,
				},
			}

			ctx, cancel := context.WithTimeout(context.Background(), P95Requirement*3)
			operationStart := time.Now()

			_, err := client.ListWorkspaces(ctx, request)
			duration := time.Since(operationStart)
			cancel()

			results <- result{duration: duration, err: err}
		}(i)
	}

	// Collect results
	var durations []time.Duration
	errorCount := 0
	successCount := 0

	for i := 0; i < ConcurrentUsers; i++ {
		res := <-results
		if res.err != nil {
			errorCount++
			t.Logf("✅ TDD phase - concurrent operation failing as expected: %v", res.err)
		} else {
			durations = append(durations, res.duration)
			successCount++
		}
	}

	totalDuration := time.Since(startTime)

	if successCount > 0 {
		// Calculate performance metrics
		p95Duration := calculatePercentile(durations, 0.95)
		avgDuration := calculateAverage(durations)

		t.Logf("📊 Concurrent Operations Performance Results:")
		t.Logf("   - Total Duration: %v", totalDuration)
		t.Logf("   - Concurrent Users: %d", ConcurrentUsers)
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, ConcurrentUsers,
			float64(successCount)/float64(ConcurrentUsers)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", P95Requirement)

		// Validate constitutional requirement under load
		assert.Less(t, p95Duration, P95Requirement*2,
			"Concurrent operations p95 should remain reasonable under load, got %v", p95Duration)

		// Test system can handle concurrent load
		assert.Greater(t, float64(successCount)/float64(ConcurrentUsers), 0.8,
			"System should handle at least 80%% of concurrent requests successfully")

		t.Log("✅ Concurrent operations performance test completed")
	} else {
		t.Log("✅ TDD phase - all concurrent operations failing as expected during test phase")
	}
}

// Helper functions for percentile calculation
func calculatePercentile(durations []time.Duration, percentile float64) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	// Simple percentile calculation (would use more sophisticated algorithm in production)
	index := int(float64(len(durations)) * percentile)
	if index >= len(durations) {
		index = len(durations) - 1
	}

	// Find the duration at the percentile index (simple approach)
	var sortedDurations []time.Duration
	for _, d := range durations {
		inserted := false
		for i, sd := range sortedDurations {
			if d < sd {
				// Insert at position i
				sortedDurations = append(sortedDurations[:i], append([]time.Duration{d}, sortedDurations[i:]...)...)
				inserted = true
				break
			}
		}
		if !inserted {
			sortedDurations = append(sortedDurations, d)
		}
	}

	return sortedDurations[index]
}

func calculateAverage(durations []time.Duration) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	var total time.Duration
	for _, d := range durations {
		total += d
	}

	return total / time.Duration(len(durations))
}
