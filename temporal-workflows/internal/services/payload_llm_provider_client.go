package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

// PayloadLLMProviderClient fetches workspace-scoped LLM credentials from the
// Payload CMS internal API and constructs runtime providers.Provider
// instances. It implements agentactivity.ProviderLoader.
type PayloadLLMProviderClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadLLMProviderClient returns a client. baseURL is the orbit-www
// base (e.g. http://orbit-www:3000); apiKey is the shared internal secret
// (ORBIT_INTERNAL_API_KEY).
func NewPayloadLLMProviderClient(baseURL, apiKey string, logger *slog.Logger) *PayloadLLMProviderClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadLLMProviderClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

type llmProviderResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Provider    string `json:"provider"`
	BaseURL     string `json:"baseUrl"`
	Model       string `json:"model"`
	APIKey      string `json:"apiKey"`
	IsDefault   bool   `json:"isDefault"`
}

// LoadProvider implements agentactivity.ProviderLoader.
func (c *PayloadLLMProviderClient) LoadProvider(ctx context.Context, workspaceID, providerID string) (providers.Provider, agentactivity.ProviderConfigSummary, error) {
	if c.baseURL == "" {
		return nil, agentactivity.ProviderConfigSummary{}, errors.New("payload llm client: base URL not configured")
	}
	if providerID == "" {
		return nil, agentactivity.ProviderConfigSummary{}, errors.New("payload llm client: provider id required")
	}

	u, err := url.Parse(fmt.Sprintf("%s/api/internal/llm-providers/%s", c.baseURL, providerID))
	if err != nil {
		return nil, agentactivity.ProviderConfigSummary{}, fmt.Errorf("build url: %w", err)
	}
	if workspaceID != "" {
		q := u.Query()
		q.Set("workspace_id", workspaceID)
		u.RawQuery = q.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, agentactivity.ProviderConfigSummary{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, agentactivity.ProviderConfigSummary{}, fmt.Errorf("payload llm client: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, agentactivity.ProviderConfigSummary{}, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return nil, agentactivity.ProviderConfigSummary{}, fmt.Errorf("payload llm client: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var data llmProviderResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, agentactivity.ProviderConfigSummary{}, fmt.Errorf("parse response: %w", err)
	}

	prov, err := providers.Build(data.Provider, providers.Config{
		APIKey:  data.APIKey,
		BaseURL: data.BaseURL,
		Model:   data.Model,
	})
	if err != nil {
		return nil, agentactivity.ProviderConfigSummary{}, err
	}

	return prov, agentactivity.ProviderConfigSummary{
		Backend: data.Provider,
		Model:   data.Model,
	}, nil
}
