package agent

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
)

// HTTPRequestInput is the http_request tool input.
type HTTPRequestInput struct {
	WorkflowID string
	Method     string            // GET / POST / PUT / DELETE / PATCH
	URL        string
	Headers    map[string]string
	Body       string
	TimeoutSec int

	// Allowlist is the workspace-configured host suffix allowlist. If empty,
	// the activity rejects all hosts (fail-closed).
	Allowlist []string
}

// HTTPRequestResult is what the agent gets back.
type HTTPRequestResult struct {
	Status     string
	StatusCode int
	Headers    map[string]string
	Body       string
	Truncated  bool
	DurationMs int64
}

// HTTPRequest performs an outbound request gated by the workspace's host
// allowlist. The same activity is reused both for the http_request tool and
// for repo-inspect API calls.
func (a *SandboxActivities) HTTPRequest(ctx context.Context, in HTTPRequestInput) (HTTPRequestResult, error) {
	if in.URL == "" {
		return HTTPRequestResult{}, temporal.NewNonRetryableApplicationError("url required", "InvalidInput", nil)
	}
	method := strings.ToUpper(strings.TrimSpace(in.Method))
	if method == "" {
		method = http.MethodGet
	}

	u, err := url.Parse(in.URL)
	if err != nil || u.Host == "" {
		return HTTPRequestResult{}, temporal.NewNonRetryableApplicationError("invalid url", "InvalidInput", err)
	}
	if !hostAllowed(u.Host, in.Allowlist) {
		return HTTPRequestResult{}, temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("host %q is not in workspace allowlist", u.Host),
			"HostNotAllowed", nil,
		)
	}

	timeout := time.Duration(in.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(cctx, method, in.URL, bytes.NewReader([]byte(in.Body)))
	if err != nil {
		return HTTPRequestResult{}, fmt.Errorf("build request: %w", err)
	}
	for k, v := range in.Headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: timeout}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return HTTPRequestResult{}, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(a.MaxOutputBytes)+1))
	if err != nil {
		return HTTPRequestResult{}, fmt.Errorf("read body: %w", err)
	}
	truncated := len(body) > a.MaxOutputBytes
	if truncated {
		body = body[:a.MaxOutputBytes]
	}

	hdr := map[string]string{}
	for k, v := range resp.Header {
		if len(v) > 0 {
			hdr[k] = v[0]
		}
	}

	return HTTPRequestResult{
		Status:     resp.Status,
		StatusCode: resp.StatusCode,
		Headers:    hdr,
		Body:       string(body),
		Truncated:  truncated,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// hostAllowed checks if host matches any entry in the allowlist. Each entry
// is interpreted as either an exact match or a "*.example.com" suffix glob.
// Empty allowlist denies everything.
func hostAllowed(host string, allowlist []string) bool {
	host = strings.ToLower(strings.Split(host, ":")[0])
	for _, entry := range allowlist {
		entry = strings.ToLower(strings.TrimSpace(entry))
		if entry == "" {
			continue
		}
		if strings.HasPrefix(entry, "*.") {
			suffix := entry[1:] // ".example.com"
			if strings.HasSuffix(host, suffix) || host == strings.TrimPrefix(suffix, ".") {
				return true
			}
		} else if host == entry {
			return true
		}
	}
	return false
}
