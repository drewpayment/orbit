package service

import (
	"context"
	"fmt"

	"github.com/drewpayment/orbit/services/plugins/internal/auth"
	"github.com/drewpayment/orbit/services/plugins/internal/backstage"
	"github.com/drewpayment/orbit/services/plugins/internal/domain"
)

// PluginsService handles business logic for plugin operations
type PluginsService struct {
	backstageClient *backstage.ClientWithCircuitBreaker
	jwtSecret       []byte
}

// NewPluginsService creates a new plugins service
func NewPluginsService(backstageClient *backstage.ClientWithCircuitBreaker, jwtSecret []byte) *PluginsService {
	return &PluginsService{
		backstageClient: backstageClient,
		jwtSecret:       jwtSecret,
	}
}

// ProxyPluginRequest proxies a request to Backstage backend
func (s *PluginsService) ProxyPluginRequest(
	ctx context.Context,
	req *ProxyRequest,
) (*ProxyResponse, error) {
	// TODO: In production, fetch plugin metadata from Payload CMS to get base path
	// For MVP, we'll use a simple mapping
	pluginBasePath := getPluginBasePath(req.PluginID)

	// Build Backstage proxy request
	backstageReq := &backstage.ProxyRequest{
		WorkspaceID:    req.WorkspaceID,
		PluginID:       req.PluginID,
		PluginBasePath: pluginBasePath,
		EndpointPath:   req.EndpointPath,
		Method:         req.Method,
		QueryParams:    req.QueryParams,
		Headers:        req.Headers,
		Body:           req.Body,
	}

	// Execute proxy request with circuit breaker
	response, err := s.backstageClient.ProxyRequest(ctx, backstageReq)
	if err != nil {
		return nil, fmt.Errorf("backstage proxy: %w", err)
	}

	return &ProxyResponse{
		StatusCode:   response.StatusCode,
		Data:         response.Data,
		Headers:      response.Headers,
		ErrorMessage: response.ErrorMessage,
	}, nil
}

// ListPlugins returns all available plugins for a workspace
func (s *PluginsService) ListPlugins(ctx context.Context, workspaceID string, category string, enabledOnly bool) ([]*domain.Plugin, error) {
	// TODO: In production, fetch from Payload CMS
	// For MVP, return hardcoded list of installed plugins
	plugins := getHardcodedPlugins()

	// Filter by category if specified
	if category != "" {
		filtered := make([]*domain.Plugin, 0)
		for _, p := range plugins {
			if p.Category == category {
				filtered = append(filtered, p)
			}
		}
		plugins = filtered
	}

	// Filter by enabled status if specified
	if enabledOnly {
		filtered := make([]*domain.Plugin, 0)
		for _, p := range plugins {
			if p.Enabled {
				filtered = append(filtered, p)
			}
		}
		plugins = filtered
	}

	return plugins, nil
}

// GetPlugin returns details for a specific plugin
func (s *PluginsService) GetPlugin(ctx context.Context, workspaceID string, pluginID string) (*domain.Plugin, error) {
	// TODO: Fetch from Payload CMS
	plugins := getHardcodedPlugins()
	for _, p := range plugins {
		if p.ID == pluginID {
			return p, nil
		}
	}
	return nil, fmt.Errorf("plugin not found: %s", pluginID)
}

// ValidateJWT validates a JWT token and returns claims
func (s *PluginsService) ValidateJWT(tokenString string) (*auth.Claims, error) {
	return auth.ValidateJWT(tokenString, s.jwtSecret)
}

// ProxyRequest represents a proxy request
type ProxyRequest struct {
	WorkspaceID  string
	PluginID     string
	EndpointPath string
	Method       string
	QueryParams  map[string]string
	Headers      map[string]string
	Body         []byte
}

// ProxyResponse represents a proxy response
type ProxyResponse struct {
	StatusCode   int
	Data         []byte
	Headers      map[string]string
	ErrorMessage string
}

// getPluginBasePath returns the API base path for a plugin
// TODO: Move this to database/config
func getPluginBasePath(pluginID string) string {
	basePaths := map[string]string{
		"catalog":        "/api/catalog",
		"scaffolder":     "/api/scaffolder",
		"github-actions": "/api/github-actions",
		"argocd":         "/api/argocd",
		"azure-devops":   "/api/azure-devops",
		"azure-resources": "/api/azure-resources",
		"kubernetes":     "/api/kubernetes",
	}

	if path, ok := basePaths[pluginID]; ok {
		return path
	}

	// Default: assume plugin ID matches base path
	return "/api/" + pluginID
}

// getHardcodedPlugins returns the list of installed plugins
// TODO: Replace with Payload CMS integration
func getHardcodedPlugins() []*domain.Plugin {
	return []*domain.Plugin{
		{
			ID:          "catalog",
			Name:        "Software Catalog",
			Description: "Centralized software catalog for tracking components, APIs, and resources",
			Category:    "api-catalog",
			Enabled:     true,
			APIBasePath: "/api/catalog",
			Metadata: domain.PluginMetadata{
				Version:           "1.24.0",
				DocumentationURL:  "https://backstage.io/docs/features/software-catalog/",
				BackstagePackage:  "@backstage/plugin-catalog-backend",
				RequiredConfigKeys: []string{},
				SupportedFeatures: []string{"entities", "locations", "search"},
			},
			Status: domain.PluginStatus{
				Healthy:       true,
				StatusMessage: "Operational",
			},
		},
		{
			ID:          "github-actions",
			Name:        "GitHub Actions",
			Description: "View and manage GitHub Actions workflows",
			Category:    "ci-cd",
			Enabled:     true,
			APIBasePath: "/api/github-actions",
			Metadata: domain.PluginMetadata{
				Version:           "0.1.0",
				DocumentationURL:  "https://github.com/backstage/community-plugins",
				BackstagePackage:  "@backstage-community/plugin-github-actions-backend",
				RequiredConfigKeys: []string{"github_token"},
				SupportedFeatures: []string{"workflows", "runs", "artifacts"},
			},
			Status: domain.PluginStatus{
				Healthy:       true,
				StatusMessage: "Operational",
			},
		},
		{
			ID:          "argocd",
			Name:        "ArgoCD",
			Description: "GitOps continuous delivery with ArgoCD",
			Category:    "infrastructure",
			Enabled:     true,
			APIBasePath: "/api/argocd",
			Metadata: domain.PluginMetadata{
				Version:           "4.4.2",
				DocumentationURL:  "https://roadie.io/backstage/plugins/argo-cd/",
				BackstagePackage:  "@roadiehq/backstage-plugin-argo-cd-backend",
				RequiredConfigKeys: []string{"argocd_url", "argocd_token"},
				SupportedFeatures: []string{"applications", "sync", "history"},
			},
			Status: domain.PluginStatus{
				Healthy:       true,
				StatusMessage: "Operational",
			},
		},
	}
}
