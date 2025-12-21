package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Client interfaces with Docker Registry v2 API
type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
	username   string
	password   string
}

// NewClient creates a new registry client
func NewClient(baseURL string, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	// Ensure URL doesn't have trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
	}
}

// NewClientWithAuth creates a new registry client with authentication
func NewClientWithAuth(baseURL, username, password string, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	// Ensure URL doesn't have trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
		username:   username,
		password:   password,
	}
}

// ManifestInfo contains image manifest details
type ManifestInfo struct {
	Digest    string
	MediaType string
	Size      int64
}

// GetManifest retrieves manifest info for an image tag
func (c *Client) GetManifest(ctx context.Context, repository, tag string) (*ManifestInfo, error) {
	url := fmt.Sprintf("%s/v2/%s/manifests/%s", c.baseURL, repository, tag)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Accept manifest types
	req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json")

	// Add authentication if configured
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("manifest not found: %s:%s", repository, tag)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	// Discard body after reading headers
	_, _ = io.Copy(io.Discard, resp.Body)

	digest := resp.Header.Get("Docker-Content-Digest")
	if digest == "" {
		return nil, fmt.Errorf("no Docker-Content-Digest header in response")
	}
	contentLength := resp.ContentLength
	mediaType := resp.Header.Get("Content-Type")

	return &ManifestInfo{
		Digest:    digest,
		MediaType: mediaType,
		Size:      contentLength,
	}, nil
}

// ImageSize calculates total image size by summing layers
func (c *Client) ImageSize(ctx context.Context, repository, tag string) (int64, error) {
	url := fmt.Sprintf("%s/v2/%s/manifests/%s", c.baseURL, repository, tag)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json")

	// Add authentication if configured
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	// Limit response body to 10MB to prevent memory exhaustion
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return 0, fmt.Errorf("failed to read response: %w", err)
	}

	var manifest struct {
		Config struct {
			Size int64 `json:"size"`
		} `json:"config"`
		Layers []struct {
			Size int64 `json:"size"`
		} `json:"layers"`
	}

	if err := json.Unmarshal(body, &manifest); err != nil {
		return 0, fmt.Errorf("failed to parse manifest: %w", err)
	}

	var total int64 = manifest.Config.Size
	for _, layer := range manifest.Layers {
		total += layer.Size
	}

	return total, nil
}

// DeleteManifest deletes an image by digest
func (c *Client) DeleteManifest(ctx context.Context, repository, digest string) error {
	url := fmt.Sprintf("%s/v2/%s/manifests/%s", c.baseURL, repository, digest)

	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Add authentication if configured
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to delete manifest, status: %d", resp.StatusCode)
	}

	c.logger.Info("Deleted manifest", "repository", repository, "digest", digest)
	return nil
}
