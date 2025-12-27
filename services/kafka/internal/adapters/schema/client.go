// Package schema provides a client for Confluent Schema Registry API
package schema

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// Config holds the connection configuration for Schema Registry
type Config struct {
	URL      string
	Username string
	Password string
}

// Validate checks if the configuration is valid
func (c Config) Validate() error {
	if c.URL == "" {
		return errors.New("URL required")
	}
	_, err := url.Parse(c.URL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	return nil
}

// Client implements the SchemaRegistryAdapter interface
type Client struct {
	baseURL    string
	httpClient *http.Client
	username   string
	password   string
}

// NewClient creates a new Schema Registry client
func NewClient(config Config) (*Client, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return &Client{
		baseURL: config.URL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		username: config.Username,
		password: config.Password,
	}, nil
}

// GenerateSubject creates a subject name from the naming template
func GenerateSubject(environment, workspace, topic, schemaType string) string {
	return fmt.Sprintf("%s.%s.%s-%s", environment, workspace, topic, schemaType)
}

// RegisterSchema registers a new schema
func (c *Client) RegisterSchema(ctx context.Context, subject string, schema adapters.SchemaSpec) (adapters.SchemaResult, error) {
	reqBody := map[string]interface{}{
		"schema":     schema.Schema,
		"schemaType": schema.SchemaType,
	}

	if len(schema.References) > 0 {
		refs := make([]map[string]interface{}, len(schema.References))
		for i, ref := range schema.References {
			refs[i] = map[string]interface{}{
				"name":    ref.Name,
				"subject": ref.Subject,
				"version": ref.Version,
			}
		}
		reqBody["references"] = refs
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return adapters.SchemaResult{}, fmt.Errorf("failed to marshal request: %w", err)
	}

	reqURL := fmt.Sprintf("%s/subjects/%s/versions", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "POST", reqURL, body)
	if err != nil {
		return adapters.SchemaResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return adapters.SchemaResult{}, c.parseError(resp)
	}

	var result struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return adapters.SchemaResult{}, fmt.Errorf("failed to decode response: %w", err)
	}

	// Get the version
	version, err := c.getLatestVersion(ctx, subject)
	if err != nil {
		return adapters.SchemaResult{}, err
	}

	return adapters.SchemaResult{
		ID:      result.ID,
		Version: version,
	}, nil
}

// GetSchema gets a specific schema version
func (c *Client) GetSchema(ctx context.Context, subject string, version int) (*adapters.SchemaInfo, error) {
	reqURL := fmt.Sprintf("%s/subjects/%s/versions/%d", c.baseURL, url.PathEscape(subject), version)
	resp, err := c.doRequest(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, adapters.ErrSchemaNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var result struct {
		Subject    string `json:"subject"`
		Version    int    `json:"version"`
		ID         int    `json:"id"`
		SchemaType string `json:"schemaType"`
		Schema     string `json:"schema"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &adapters.SchemaInfo{
		Subject:    result.Subject,
		Version:    result.Version,
		ID:         result.ID,
		SchemaType: result.SchemaType,
		Schema:     result.Schema,
	}, nil
}

// GetLatestSchema gets the latest schema version
func (c *Client) GetLatestSchema(ctx context.Context, subject string) (*adapters.SchemaInfo, error) {
	reqURL := fmt.Sprintf("%s/subjects/%s/versions/latest", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, adapters.ErrSchemaNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var result struct {
		Subject    string `json:"subject"`
		Version    int    `json:"version"`
		ID         int    `json:"id"`
		SchemaType string `json:"schemaType"`
		Schema     string `json:"schema"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &adapters.SchemaInfo{
		Subject:    result.Subject,
		Version:    result.Version,
		ID:         result.ID,
		SchemaType: result.SchemaType,
		Schema:     result.Schema,
	}, nil
}

// ListVersions lists all versions for a subject
func (c *Client) ListVersions(ctx context.Context, subject string) ([]int, error) {
	reqURL := fmt.Sprintf("%s/subjects/%s/versions", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, adapters.ErrSchemaNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var versions []int
	if err := json.NewDecoder(resp.Body).Decode(&versions); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return versions, nil
}

// CheckCompatibility checks if a schema is compatible
func (c *Client) CheckCompatibility(ctx context.Context, subject string, schema adapters.SchemaSpec) (bool, error) {
	reqBody := map[string]interface{}{
		"schema":     schema.Schema,
		"schemaType": schema.SchemaType,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return false, fmt.Errorf("failed to marshal request: %w", err)
	}

	reqURL := fmt.Sprintf("%s/compatibility/subjects/%s/versions/latest", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "POST", reqURL, body)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	// 404 means no existing schema - new schemas are always compatible
	if resp.StatusCode == http.StatusNotFound {
		return true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, c.parseError(resp)
	}

	var result struct {
		IsCompatible bool `json:"is_compatible"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.IsCompatible, nil
}

// DeleteSubject deletes a subject and all its versions
func (c *Client) DeleteSubject(ctx context.Context, subject string) error {
	reqURL := fmt.Sprintf("%s/subjects/%s", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "DELETE", reqURL, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil // Already deleted
	}
	if resp.StatusCode != http.StatusOK {
		return c.parseError(resp)
	}

	return nil
}

// ListSubjects lists all subjects
func (c *Client) ListSubjects(ctx context.Context) ([]string, error) {
	reqURL := fmt.Sprintf("%s/subjects", c.baseURL)
	resp, err := c.doRequest(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, c.parseError(resp)
	}

	var subjects []string
	if err := json.NewDecoder(resp.Body).Decode(&subjects); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return subjects, nil
}

// GetCompatibility gets the compatibility level for a subject
func (c *Client) GetCompatibility(ctx context.Context, subject string) (domain.SchemaCompatibility, error) {
	reqURL := fmt.Sprintf("%s/config/%s", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "GET", reqURL, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// 404 means using global default
	if resp.StatusCode == http.StatusNotFound {
		return c.getGlobalCompatibility(ctx)
	}
	if resp.StatusCode != http.StatusOK {
		return "", c.parseError(resp)
	}

	var result struct {
		CompatibilityLevel string `json:"compatibilityLevel"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return mapCompatibility(result.CompatibilityLevel), nil
}

// SetCompatibility sets the compatibility level for a subject
func (c *Client) SetCompatibility(ctx context.Context, subject string, compatibility domain.SchemaCompatibility) error {
	reqBody := map[string]string{
		"compatibility": mapCompatibilityToAPI(compatibility),
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	reqURL := fmt.Sprintf("%s/config/%s", c.baseURL, url.PathEscape(subject))
	resp, err := c.doRequest(ctx, "PUT", reqURL, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return c.parseError(resp)
	}

	return nil
}

// Helper methods

func (c *Client) doRequest(ctx context.Context, method, url string, body []byte) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/vnd.schemaregistry.v1+json")
	req.Header.Set("Accept", "application/vnd.schemaregistry.v1+json")

	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}

	return c.httpClient.Do(req)
}

func (c *Client) parseError(resp *http.Response) error {
	body, _ := io.ReadAll(resp.Body)
	var errResp struct {
		ErrorCode int    `json:"error_code"`
		Message   string `json:"message"`
	}
	if err := json.Unmarshal(body, &errResp); err != nil {
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}
	return fmt.Errorf("schema registry error %d: %s", errResp.ErrorCode, errResp.Message)
}

func (c *Client) getLatestVersion(ctx context.Context, subject string) (int, error) {
	versions, err := c.ListVersions(ctx, subject)
	if err != nil {
		// If subject doesn't exist yet, return version 1
		if errors.Is(err, adapters.ErrSchemaNotFound) {
			return 1, nil
		}
		return 0, err
	}
	if len(versions) == 0 {
		return 1, nil
	}
	return versions[len(versions)-1], nil
}

func (c *Client) getGlobalCompatibility(ctx context.Context) (domain.SchemaCompatibility, error) {
	reqURL := fmt.Sprintf("%s/config", c.baseURL)
	resp, err := c.doRequest(ctx, "GET", reqURL, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return domain.SchemaCompatibilityBackward, nil // Default
	}

	var result struct {
		CompatibilityLevel string `json:"compatibilityLevel"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return domain.SchemaCompatibilityBackward, nil
	}

	return mapCompatibility(result.CompatibilityLevel), nil
}

func mapCompatibility(level string) domain.SchemaCompatibility {
	switch level {
	case "BACKWARD", "BACKWARD_TRANSITIVE":
		return domain.SchemaCompatibilityBackward
	case "FORWARD", "FORWARD_TRANSITIVE":
		return domain.SchemaCompatibilityForward
	case "FULL", "FULL_TRANSITIVE":
		return domain.SchemaCompatibilityFull
	case "NONE":
		return domain.SchemaCompatibilityNone
	default:
		return domain.SchemaCompatibilityBackward
	}
}

func mapCompatibilityToAPI(c domain.SchemaCompatibility) string {
	switch c {
	case domain.SchemaCompatibilityBackward:
		return "BACKWARD"
	case domain.SchemaCompatibilityForward:
		return "FORWARD"
	case domain.SchemaCompatibilityFull:
		return "FULL"
	case domain.SchemaCompatibilityNone:
		return "NONE"
	default:
		return "BACKWARD"
	}
}

// Ensure Client implements SchemaRegistryAdapter
var _ adapters.SchemaRegistryAdapter = (*Client)(nil)
