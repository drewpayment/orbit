// Package metrics provides Prometheus metrics for the Bifrost Kafka proxy.
package metrics

import (
	"strconv"

	"github.com/prometheus/client_golang/prometheus"
)

// Collector holds Prometheus metrics for Bifrost.
type Collector struct {
	connectionsActive *prometheus.GaugeVec
	connectionsTotal  *prometheus.CounterVec
	bytesTotal        *prometheus.CounterVec
	requestsTotal     *prometheus.CounterVec
	requestDuration   *prometheus.HistogramVec
}

// NewCollector creates a new metrics collector.
func NewCollector() *Collector {
	return &Collector{
		connectionsActive: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "bifrost_connections_active",
				Help: "Number of active client connections",
			},
			[]string{"virtual_cluster"},
		),
		connectionsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "bifrost_connections_total",
				Help: "Total number of client connections",
			},
			[]string{"virtual_cluster"},
		),
		bytesTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "bifrost_bytes_total",
				Help: "Total bytes transferred",
			},
			[]string{"virtual_cluster", "direction"},
		),
		requestsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "bifrost_requests_total",
				Help: "Total Kafka API requests",
			},
			[]string{"virtual_cluster", "api_key"},
		),
		requestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "bifrost_request_duration_seconds",
				Help:    "Request processing duration",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"virtual_cluster", "api_key"},
		),
	}
}

// Describe implements prometheus.Collector.
func (c *Collector) Describe(ch chan<- *prometheus.Desc) {
	c.connectionsActive.Describe(ch)
	c.connectionsTotal.Describe(ch)
	c.bytesTotal.Describe(ch)
	c.requestsTotal.Describe(ch)
	c.requestDuration.Describe(ch)
}

// Collect implements prometheus.Collector.
func (c *Collector) Collect(ch chan<- prometheus.Metric) {
	c.connectionsActive.Collect(ch)
	c.connectionsTotal.Collect(ch)
	c.bytesTotal.Collect(ch)
	c.requestsTotal.Collect(ch)
	c.requestDuration.Collect(ch)
}

// RecordConnection records a connection event.
func (c *Collector) RecordConnection(virtualCluster string, opened bool) {
	if opened {
		c.connectionsActive.WithLabelValues(virtualCluster).Inc()
		c.connectionsTotal.WithLabelValues(virtualCluster).Inc()
	} else {
		c.connectionsActive.WithLabelValues(virtualCluster).Dec()
	}
}

// RecordBytes records bytes transferred.
func (c *Collector) RecordBytes(virtualCluster, direction string, bytes int64) {
	c.bytesTotal.WithLabelValues(virtualCluster, direction).Add(float64(bytes))
}

// RecordRequest records a Kafka API request.
func (c *Collector) RecordRequest(virtualCluster string, apiKey int16, durationSeconds float64) {
	apiKeyStr := strconv.Itoa(int(apiKey))
	c.requestsTotal.WithLabelValues(virtualCluster, apiKeyStr).Inc()
	c.requestDuration.WithLabelValues(virtualCluster, apiKeyStr).Observe(durationSeconds)
}
