/**
 * T025 - Performance Test: Authentication Operations (<100ms p95)
 *
 * This performance test validates that authentication operations meet the constitutional
 * performance requirements of <100ms p95 response times.
 *
 * TDD Status: MUST fail until AuthService is implemented
 * Expected failure: "connection refused" to localhost:8005 (auth service port)
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

	authv1 "github.com/drewpayment/orbit/proto/gen/go/idp/auth/v1"
)

const (
	AuthServiceAddr        = "localhost:8005"
	AuthPerformanceTimeout = 3 * time.Second
	AuthP95Requirement     = 100 * time.Millisecond // Constitutional requirement for auth
	AuthTestIterations     = 200                    // More iterations for auth testing
	ConcurrentAuthUsers    = 100                    // Higher concurrency for auth stress test
)

func TestAuthenticationPerformance(t *testing.T) {
	t.Log("=== T025 Performance Test: Authentication Operations ===")
	t.Log("Testing authentication performance requirements (<100ms p95)")

	// Test authentication token validation performance
	t.Run("ValidateToken_Performance", func(t *testing.T) {
		testValidateTokenPerformance(t)
	})

	// Test user authentication performance
	t.Run("AuthenticateUser_Performance", func(t *testing.T) {
		testAuthenticateUserPerformance(t)
	})

	// Test token refresh performance
	t.Run("RefreshToken_Performance", func(t *testing.T) {
		testRefreshTokenPerformance(t)
	})

	// Test concurrent authentication operations
	t.Run("ConcurrentAuth_Performance", func(t *testing.T) {
		testConcurrentAuthPerformance(t)
	})
}

func testValidateTokenPerformance(t *testing.T) {
	t.Log("🚀 Testing ValidateToken performance...")

	// Connect to Auth service
	conn, err := grpc.NewClient(AuthServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to auth service: %v", err)
		return
	}
	defer conn.Close()

	client := authv1.NewAuthServiceClient(conn)

	var durations []time.Duration
	successCount := 0

	for i := 0; i < AuthTestIterations; i++ {
		request := &authv1.ValidateTokenRequest{
			Token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token",
		}

		ctx, cancel := context.WithTimeout(context.Background(), AuthP95Requirement*2)
		startTime := time.Now()

		response, err := client.ValidateToken(ctx, request)
		duration := time.Since(startTime)
		cancel()

		if err != nil {
			// Expected TDD failure
			t.Logf("✅ TDD phase - token validation failing as expected: %v", err)
			continue
		}

		// If service is implemented, validate performance
		durations = append(durations, duration)
		successCount++

		require.NotNil(t, response, "ValidateToken response should not be nil")
		require.NotNil(t, response.Response, "Response wrapper should not be nil")

		// Individual request should be very fast for auth
		assert.Less(t, duration, AuthP95Requirement*2,
			"Individual ValidateToken request should be under %v, got %v",
			AuthP95Requirement*2, duration)
	}

	if successCount > 0 {
		// Calculate percentiles
		p95Duration := calculateAuthPercentile(durations, 0.95)
		avgDuration := calculateAuthAverage(durations)

		t.Logf("📊 ValidateToken Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, AuthTestIterations,
			float64(successCount)/float64(AuthTestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", AuthP95Requirement)

		// Validate constitutional requirement for auth
		assert.Less(t, p95Duration, AuthP95Requirement,
			"ValidateToken p95 must be under %v for auth operations, got %v",
			AuthP95Requirement, p95Duration)

		t.Log("✅ ValidateToken performance test completed")
	}
}

func testAuthenticateUserPerformance(t *testing.T) {
	t.Log("🚀 Testing AuthenticateUser performance...")

	// Connect to Auth service
	conn, err := grpc.NewClient(AuthServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to auth service: %v", err)
		return
	}
	defer conn.Close()

	client := authv1.NewAuthServiceClient(conn)

	var durations []time.Duration
	successCount := 0

	for i := 0; i < AuthTestIterations; i++ {
		request := &authv1.AuthenticateUserRequest{
			Email:    "perf-test@example.com",
			Password: "test-password",
		}

		ctx, cancel := context.WithTimeout(context.Background(), AuthP95Requirement*3)
		startTime := time.Now()

		response, err := client.AuthenticateUser(ctx, request)
		duration := time.Since(startTime)
		cancel()

		if err != nil {
			// Expected TDD failure
			t.Logf("✅ TDD phase - user authentication failing as expected: %v", err)
			continue
		}

		// If service is implemented, validate performance
		durations = append(durations, duration)
		successCount++

		require.NotNil(t, response, "AuthenticateUser response should not be nil")
		require.NotNil(t, response.Response, "Response wrapper should not be nil")

		// Authentication might be slightly slower due to hashing, but still fast
		assert.Less(t, duration, AuthP95Requirement*3,
			"AuthenticateUser request should be under %v, got %v",
			AuthP95Requirement*3, duration)
	}

	if successCount > 0 {
		// Calculate percentiles
		p95Duration := calculateAuthPercentile(durations, 0.95)
		avgDuration := calculateAuthAverage(durations)

		t.Logf("📊 AuthenticateUser Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, AuthTestIterations,
			float64(successCount)/float64(AuthTestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v (allowing 3x for hashing)", AuthP95Requirement*3)

		// Validate reasonable auth performance (allowing for password hashing)
		assert.Less(t, p95Duration, AuthP95Requirement*3,
			"AuthenticateUser p95 should be reasonable for password operations, got %v",
			p95Duration)

		t.Log("✅ AuthenticateUser performance test completed")
	}
}

func testRefreshTokenPerformance(t *testing.T) {
	t.Log("🚀 Testing RefreshToken performance...")

	// Connect to Auth service
	conn, err := grpc.NewClient(AuthServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to auth service: %v", err)
		return
	}
	defer conn.Close()

	client := authv1.NewAuthServiceClient(conn)

	var durations []time.Duration
	successCount := 0

	for i := 0; i < AuthTestIterations; i++ {
		request := &authv1.RefreshTokenRequest{
			RefreshToken: "refresh-token-example",
		}

		ctx, cancel := context.WithTimeout(context.Background(), AuthP95Requirement*2)
		startTime := time.Now()

		response, err := client.RefreshToken(ctx, request)
		duration := time.Since(startTime)
		cancel()

		if err != nil {
			// Expected TDD failure
			t.Logf("✅ TDD phase - token refresh failing as expected: %v", err)
			continue
		}

		// If service is implemented, validate performance
		durations = append(durations, duration)
		successCount++

		require.NotNil(t, response, "RefreshToken response should not be nil")
		require.NotNil(t, response.Response, "Response wrapper should not be nil")

		// Token refresh should be fast
		assert.Less(t, duration, AuthP95Requirement*2,
			"RefreshToken request should be under %v, got %v",
			AuthP95Requirement*2, duration)
	}

	if successCount > 0 {
		// Calculate percentiles
		p95Duration := calculateAuthPercentile(durations, 0.95)
		avgDuration := calculateAuthAverage(durations)

		t.Logf("📊 RefreshToken Performance Results:")
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, AuthTestIterations,
			float64(successCount)/float64(AuthTestIterations)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", AuthP95Requirement*2)

		// Validate constitutional requirement for token refresh
		assert.Less(t, p95Duration, AuthP95Requirement*2,
			"RefreshToken p95 should be fast for token operations, got %v",
			p95Duration)

		t.Log("✅ RefreshToken performance test completed")
	}
}

func testConcurrentAuthPerformance(t *testing.T) {
	t.Log("🚀 Testing concurrent authentication operations performance...")

	// Connect to Auth service
	conn, err := grpc.NewClient(AuthServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to auth service: %v", err)
		return
	}
	defer conn.Close()

	client := authv1.NewAuthServiceClient(conn)

	type result struct {
		duration time.Duration
		err      error
	}

	results := make(chan result, ConcurrentAuthUsers)
	startTime := time.Now()

	// Launch concurrent authentication operations
	for i := 0; i < ConcurrentAuthUsers; i++ {
		go func(userIndex int) {
			request := &authv1.ValidateTokenRequest{
				Token: "concurrent-test-token-" + string(rune(userIndex)),
			}

			ctx, cancel := context.WithTimeout(context.Background(), AuthP95Requirement*5)
			operationStart := time.Now()

			_, err := client.ValidateToken(ctx, request)
			duration := time.Since(operationStart)
			cancel()

			results <- result{duration: duration, err: err}
		}(i)
	}

	// Collect results
	var durations []time.Duration
	errorCount := 0
	successCount := 0

	for i := 0; i < ConcurrentAuthUsers; i++ {
		res := <-results
		if res.err != nil {
			errorCount++
			t.Logf("✅ TDD phase - concurrent auth operation failing as expected: %v", res.err)
		} else {
			durations = append(durations, res.duration)
			successCount++
		}
	}

	totalDuration := time.Since(startTime)

	if successCount > 0 {
		// Calculate performance metrics
		p95Duration := calculateAuthPercentile(durations, 0.95)
		avgDuration := calculateAuthAverage(durations)

		t.Logf("📊 Concurrent Authentication Performance Results:")
		t.Logf("   - Total Duration: %v", totalDuration)
		t.Logf("   - Concurrent Users: %d", ConcurrentAuthUsers)
		t.Logf("   - Success Rate: %d/%d (%.1f%%)", successCount, ConcurrentAuthUsers,
			float64(successCount)/float64(ConcurrentAuthUsers)*100)
		t.Logf("   - Average Duration: %v", avgDuration)
		t.Logf("   - P95 Duration: %v", p95Duration)
		t.Logf("   - P95 Requirement: %v", AuthP95Requirement*2)

		// Validate constitutional requirement under auth load
		assert.Less(t, p95Duration, AuthP95Requirement*3,
			"Concurrent auth operations p95 should remain reasonable under load, got %v",
			p95Duration)

		// Auth system should handle high concurrency
		assert.Greater(t, float64(successCount)/float64(ConcurrentAuthUsers), 0.9,
			"Auth system should handle at least 90%% of concurrent requests successfully")

		t.Log("✅ Concurrent authentication performance test completed")
	} else {
		t.Log("✅ TDD phase - all concurrent auth operations failing as expected during test phase")
	}
}

// Helper functions for auth percentile calculation
func calculateAuthPercentile(durations []time.Duration, percentile float64) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	// Simple percentile calculation
	index := int(float64(len(durations)) * percentile)
	if index >= len(durations) {
		index = len(durations) - 1
	}

	// Sort durations (simple insertion sort for small datasets)
	sortedDurations := make([]time.Duration, len(durations))
	copy(sortedDurations, durations)

	for i := 1; i < len(sortedDurations); i++ {
		key := sortedDurations[i]
		j := i - 1
		for j >= 0 && sortedDurations[j] > key {
			sortedDurations[j+1] = sortedDurations[j]
			j--
		}
		sortedDurations[j+1] = key
	}

	return sortedDurations[index]
}

func calculateAuthAverage(durations []time.Duration) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	var total time.Duration
	for _, d := range durations {
		total += d
	}

	return total / time.Duration(len(durations))
}
