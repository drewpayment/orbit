package backstage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client is an HTTP client for communicating with Backstage backend
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new Backstage HTTP client
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ProxyRequest represents a generic proxy request to Backstage
type ProxyRequest struct {
	WorkspaceID    string
	PluginID       string
	PluginBasePath string // e.g., "/api/argocd"
	EndpointPath   string // e.g., "/applications"
	Method         string // GET, POST, PUT, DELETE
	QueryParams    map[string]string
	Headers        map[string]string
	Body           []byte
}

// ProxyResponse represents the response from Backstage
type ProxyResponse struct {
	StatusCode   int
	Data         []byte
	Headers      map[string]string
	ErrorMessage string
}

// ProxyRequest forwards a request to Backstage backend
// This is a generic proxy that works for all plugins
func (c *Client) ProxyRequest(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
	// Build full URL
	fullURL := fmt.Sprintf("%s%s%s", c.baseURL, req.PluginBasePath, req.EndpointPath)

	// Add query parameters
	if len(req.QueryParams) > 0 {
		params := url.Values{}
		for k, v := range req.QueryParams {
			params.Add(k, v)
		}
		fullURL = fmt.Sprintf("%s?%s", fullURL, params.Encode())
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, fullURL, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// CRITICAL: Inject workspace ID header for Backstage's isolation middleware
	httpReq.Header.Set("X-Orbit-Workspace-Id", req.WorkspaceID)
	httpReq.Header.Set("X-Orbit-Plugin-Id", req.PluginID)

	// Forward additional headers
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	// Set default headers if not provided
	if httpReq.Header.Get("Content-Type") == "" && len(req.Body) > 0 {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	if httpReq.Header.Get("Accept") == "" {
		httpReq.Header.Set("Accept", "application/json")
	}

	// Execute request
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http call: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	// Convert response headers
	headers := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}

	// Build response
	proxyResp := &ProxyResponse{
		StatusCode: resp.StatusCode,
		Data:       body,
		Headers:    headers,
	}

	// Extract error message if status code indicates error
	if resp.StatusCode >= 400 {
		proxyResp.ErrorMessage = extractErrorMessage(resp.StatusCode, body)
	}

	return proxyResp, nil
}

// extractErrorMessage attempts to extract a meaningful error message from response
func extractErrorMessage(statusCode int, body []byte) string {
	// Try to parse as JSON error
	var errorResp struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}

	if err := json.Unmarshal(body, &errorResp); err == nil {
		if errorResp.Error != "" {
			return errorResp.Error
		}
		if errorResp.Message != "" {
			return errorResp.Message
		}
	}

	// Fallback to generic HTTP status message
	return fmt.Sprintf("HTTP %d", statusCode)
}

// HealthCheck checks if Backstage backend is healthy
func (c *Client) HealthCheck(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/healthcheck", nil)
	if err != nil {
		return fmt.Errorf("create health check request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unhealthy status: %d", resp.StatusCode)
	}

	return nil
}
