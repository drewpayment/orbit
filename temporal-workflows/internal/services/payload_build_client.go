package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// DetectedBuildConfig matches the activities.DetectedBuildConfig type
type DetectedBuildConfig struct {
	Language        string `json:"language"`
	LanguageVersion string `json:"languageVersion"`
	Framework       string `json:"framework"`
	BuildCommand    string `json:"buildCommand"`
	StartCommand    string `json:"startCommand"`
}

// PayloadBuildClientImpl implements PayloadBuildClient for Payload CMS
type PayloadBuildClientImpl struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPayloadBuildClient creates a new PayloadBuildClient
func NewPayloadBuildClient(baseURL, apiKey string) *PayloadBuildClientImpl {
	return &PayloadBuildClientImpl{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// UpdateAppBuildStatus updates the build status on an App document via internal API
func (c *PayloadBuildClientImpl) UpdateAppBuildStatus(
	ctx context.Context,
	appID string,
	status string,
	imageURL string,
	imageDigest string,
	errorMsg string,
	buildConfig *DetectedBuildConfig,
	availableChoices []string,
) error {
	url := fmt.Sprintf("%s/api/internal/apps/%s/build-status", c.baseURL, appID)

	body := map[string]interface{}{
		"status":      status,
		"imageUrl":    imageURL,
		"imageDigest": imageDigest,
		"error":       errorMsg,
	}

	if buildConfig != nil {
		body["buildConfig"] = map[string]interface{}{
			"language":        buildConfig.Language,
			"languageVersion": buildConfig.LanguageVersion,
			"framework":       buildConfig.Framework,
			"buildCommand":    buildConfig.BuildCommand,
			"startCommand":    buildConfig.StartCommand,
		}
	}

	if len(availableChoices) > 0 {
		body["availableChoices"] = availableChoices
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PATCH", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("X-API-Key", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// GetGitHubInstallationToken gets a GitHub installation token for a workspace
func (c *PayloadBuildClientImpl) GetGitHubInstallationToken(ctx context.Context, workspaceID string) (string, error) {
	// This is not currently used - tokens are passed through the workflow input
	return "", fmt.Errorf("not implemented")
}

// RegistryConfigData matches the activities.RegistryConfigData type
type RegistryConfigData struct {
	Type           string `json:"type"`
	GHCROwner      string `json:"ghcrOwner"`
	ACRLoginServer string `json:"acrLoginServer"`
	ACRUsername    string `json:"acrUsername"`
	ACRToken       string `json:"acrToken"`
}

// GetRegistryConfig gets registry configuration
func (c *PayloadBuildClientImpl) GetRegistryConfig(ctx context.Context, registryID string) (*RegistryConfigData, error) {
	// This is not currently used - registry config is passed through the workflow input
	return nil, fmt.Errorf("not implemented")
}
