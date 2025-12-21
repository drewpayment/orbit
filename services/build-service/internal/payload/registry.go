package payload

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// RegistryClient handles Payload CMS registry operations
type RegistryClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewRegistryClient creates a new Payload registry client
func NewRegistryClient(baseURL, apiKey string, logger *slog.Logger) *RegistryClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &RegistryClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
	}
}

// RegistryUsage represents workspace registry usage
type RegistryUsage struct {
	CurrentBytes int64 `json:"currentBytes"`
	QuotaBytes   int64 `json:"quotaBytes"`
}

// RegistryImage represents an image record from Payload
type RegistryImage struct {
	ID        string    `json:"id"`
	Workspace string    `json:"workspace"`
	App       string    `json:"app"`
	AppName   string    `json:"appName"`
	Tag       string    `json:"tag"`
	Digest    string    `json:"digest"`
	SizeBytes int64     `json:"sizeBytes"`
	PushedAt  time.Time `json:"pushedAt"`
}

// GetRegistryUsage fetches current registry usage for a workspace
func (c *RegistryClient) GetRegistryUsage(ctx context.Context, workspaceID string) (*RegistryUsage, error) {
	url := fmt.Sprintf("%s/api/internal/workspaces/%s/registry-usage", c.baseURL, workspaceID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch registry usage: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var usage RegistryUsage
	if err := json.NewDecoder(resp.Body).Decode(&usage); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &usage, nil
}

// GetRegistryImages fetches all registry images for a workspace
func (c *RegistryClient) GetRegistryImages(ctx context.Context, workspaceID string) ([]RegistryImage, error) {
	url := fmt.Sprintf("%s/api/internal/workspaces/%s/registry-images", c.baseURL, workspaceID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch registry images: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var images []RegistryImage
	if err := json.NewDecoder(resp.Body).Decode(&images); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return images, nil
}

// CreateRegistryImage creates or updates a registry image record
func (c *RegistryClient) CreateRegistryImage(ctx context.Context, image RegistryImage) error {
	url := fmt.Sprintf("%s/api/internal/registry-images", c.baseURL)

	body, err := json.Marshal(image)
	if err != nil {
		return fmt.Errorf("failed to marshal image: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to create registry image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// DeleteRegistryImage deletes a registry image record
func (c *RegistryClient) DeleteRegistryImage(ctx context.Context, imageID string) error {
	url := fmt.Sprintf("%s/api/internal/registry-images/%s", c.baseURL, imageID)

	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete registry image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
