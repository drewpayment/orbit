package activities

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPerformHealthCheckActivity_Healthy(t *testing.T) {
	// Setup test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "healthy", result.Status)
	assert.Equal(t, 200, result.StatusCode)
	assert.Greater(t, result.ResponseTime, int64(0))
}

func TestPerformHealthCheckActivity_Down(t *testing.T) {
	// Setup test server that returns 500
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "down", result.Status)
	assert.Equal(t, 500, result.StatusCode)
}

func TestPerformHealthCheckActivity_Degraded(t *testing.T) {
	// Setup test server that returns 404
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	activities := NewHealthCheckActivities(nil)

	input := PerformHealthCheckInput{
		URL:            server.URL,
		Method:         "GET",
		ExpectedStatus: 200,
		Timeout:        10,
	}

	result, err := activities.PerformHealthCheckActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "degraded", result.Status)
	assert.Equal(t, 404, result.StatusCode)
}
