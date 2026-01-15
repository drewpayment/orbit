package workflows

// Constants for health check workflow
const (
	// MaxChecksBeforeContinueAsNew limits workflow history size
	MaxChecksBeforeContinueAsNew = 100

	// MinHealthCheckInterval is the minimum allowed interval in seconds
	MinHealthCheckInterval = 30

	// QueryHealthStatus is the query name for getting current health status
	QueryHealthStatus = "health_status"
)

// HealthConfig contains configuration for health checks
type HealthConfig struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ExpectedStatus int    `json:"expectedStatus"`
	Interval       int    `json:"interval"`
	Timeout        int    `json:"timeout"`
}

// HealthCheckWorkflowInput contains all parameters for the workflow
type HealthCheckWorkflowInput struct {
	AppID           string       `json:"appId"`
	HealthConfig    HealthConfig `json:"healthConfig"`
	ChecksPerformed int          `json:"checksPerformed"` // Carried across ContinueAsNew
	LastResult      *HealthCheckResult `json:"lastResult"`      // Carried across ContinueAsNew for query continuity
}

// HealthCheckResult contains the result of a health check
type HealthCheckResult struct {
	Status       string `json:"status"` // healthy, degraded, down
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"` // milliseconds
	Error        string `json:"error"`
}

// HealthStatusQueryResult is returned by the health status query
type HealthStatusQueryResult struct {
	Status          string `json:"status"`          // pending, healthy, degraded, down
	StatusCode      int    `json:"statusCode"`
	ResponseTime    int64  `json:"responseTime"`
	Error           string `json:"error"`
	ChecksPerformed int    `json:"checksPerformed"`
	LastCheckedAt   string `json:"lastCheckedAt"`
}
