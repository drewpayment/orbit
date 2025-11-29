package workflows

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
	AppID        string       `json:"appId"`
	HealthConfig HealthConfig `json:"healthConfig"`
}

// HealthCheckResult contains the result of a health check
type HealthCheckResult struct {
	Status       string `json:"status"` // healthy, degraded, down
	StatusCode   int    `json:"statusCode"`
	ResponseTime int64  `json:"responseTime"` // milliseconds
	Error        string `json:"error"`
}
