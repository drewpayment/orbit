// Package metrics provides Prometheus metrics for the Bifrost Kafka proxy.
package metrics

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCollector_RecordConnection(t *testing.T) {
	// Create a new registry for testing
	reg := prometheus.NewRegistry()
	c := NewCollector()
	reg.MustRegister(c)

	c.RecordConnection("vc-123", true)
	c.RecordConnection("vc-123", true)
	c.RecordConnection("vc-123", false)

	// Verify metrics were recorded (no panic)
	assert.NotNil(t, c)

	// Verify active connections: 2 opened - 1 closed = 1 active
	activeCount := testutil.ToFloat64(c.connectionsActive.WithLabelValues("vc-123"))
	assert.Equal(t, float64(1), activeCount)

	// Verify total connections: 2 opened
	totalCount := testutil.ToFloat64(c.connectionsTotal.WithLabelValues("vc-123"))
	assert.Equal(t, float64(2), totalCount)
}

func TestCollector_RecordBytes(t *testing.T) {
	reg := prometheus.NewRegistry()
	c := NewCollector()
	reg.MustRegister(c)

	c.RecordBytes("vc-123", "in", 1024)
	c.RecordBytes("vc-123", "out", 2048)
	c.RecordBytes("vc-123", "in", 512)

	assert.NotNil(t, c)

	// Verify bytes in
	bytesIn := testutil.ToFloat64(c.bytesTotal.WithLabelValues("vc-123", "in"))
	assert.Equal(t, float64(1536), bytesIn) // 1024 + 512

	// Verify bytes out
	bytesOut := testutil.ToFloat64(c.bytesTotal.WithLabelValues("vc-123", "out"))
	assert.Equal(t, float64(2048), bytesOut)
}

func TestCollector_RecordRequest(t *testing.T) {
	reg := prometheus.NewRegistry()
	c := NewCollector()
	reg.MustRegister(c)

	c.RecordRequest("vc-123", 0, 0.005) // Produce request, 5ms
	c.RecordRequest("vc-123", 0, 0.010) // Another Produce request, 10ms
	c.RecordRequest("vc-123", 1, 0.003) // Fetch request, 3ms

	assert.NotNil(t, c)

	// Verify request counts
	produceCount := testutil.ToFloat64(c.requestsTotal.WithLabelValues("vc-123", "0"))
	assert.Equal(t, float64(2), produceCount)

	fetchCount := testutil.ToFloat64(c.requestsTotal.WithLabelValues("vc-123", "1"))
	assert.Equal(t, float64(1), fetchCount)
}

func TestCollector_DescribeAndCollect(t *testing.T) {
	c := NewCollector()

	// Record some metrics
	c.RecordConnection("vc-test", true)
	c.RecordBytes("vc-test", "in", 100)
	c.RecordRequest("vc-test", 0, 0.001)

	// Test Describe
	descCh := make(chan *prometheus.Desc, 10)
	c.Describe(descCh)
	close(descCh)

	descCount := 0
	for range descCh {
		descCount++
	}
	// Should have 5 metric types described
	assert.Equal(t, 5, descCount)

	// Test Collect
	metricCh := make(chan prometheus.Metric, 20)
	c.Collect(metricCh)
	close(metricCh)

	metricCount := 0
	for range metricCh {
		metricCount++
	}
	// Should have metrics collected (at least the ones we recorded)
	assert.Greater(t, metricCount, 0)
}

func TestCollector_MultipleVirtualClusters(t *testing.T) {
	reg := prometheus.NewRegistry()
	c := NewCollector()
	reg.MustRegister(c)

	// Record metrics for multiple virtual clusters
	c.RecordConnection("vc-alpha", true)
	c.RecordConnection("vc-beta", true)
	c.RecordConnection("vc-alpha", true)

	// Verify isolation between virtual clusters
	alphaActive := testutil.ToFloat64(c.connectionsActive.WithLabelValues("vc-alpha"))
	assert.Equal(t, float64(2), alphaActive)

	betaActive := testutil.ToFloat64(c.connectionsActive.WithLabelValues("vc-beta"))
	assert.Equal(t, float64(1), betaActive)
}

func TestNewCollector(t *testing.T) {
	c := NewCollector()

	require.NotNil(t, c)
	require.NotNil(t, c.connectionsActive)
	require.NotNil(t, c.connectionsTotal)
	require.NotNil(t, c.bytesTotal)
	require.NotNil(t, c.requestsTotal)
	require.NotNil(t, c.requestDuration)
}
