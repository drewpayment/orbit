package grpc

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	pluginsv1 "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1"
	"github.com/drewpayment/orbit/services/plugins/internal/service"
)

// Server implements the gRPC PluginsService
type Server struct {
	pluginsv1.UnimplementedPluginsServiceServer
	pluginsService *service.PluginsService
}

// NewServer creates a new gRPC server
func NewServer(pluginsService *service.PluginsService) *Server {
	return &Server{
		pluginsService: pluginsService,
	}
}

// ListPlugins lists all available plugins for a workspace
func (s *Server) ListPlugins(
	ctx context.Context,
	req *pluginsv1.ListPluginsRequest,
) (*pluginsv1.ListPluginsResponse, error) {
	// Validate request
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}

	// Validate workspace access
	if err := s.validateWorkspaceAccess(ctx, req.WorkspaceId); err != nil {
		return nil, err
	}

	// Get plugins from service
	enabledOnly := req.EnabledOnly != nil && *req.EnabledOnly
	plugins, err := s.pluginsService.ListPlugins(ctx, req.WorkspaceId, req.Category, enabledOnly)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list plugins: %v", err)
	}

	// Convert to protobuf
	pbPlugins := make([]*pluginsv1.Plugin, len(plugins))
	for i, p := range plugins {
		pbPlugins[i] = &pluginsv1.Plugin{
			Id:          p.ID,
			Name:        p.Name,
			Description: p.Description,
			Category:    p.Category,
			Enabled:     p.Enabled,
			ApiBasePath: p.APIBasePath,
			Config:      p.Config,
			Metadata: &pluginsv1.PluginMetadata{
				Version:             p.Metadata.Version,
				DocumentationUrl:    p.Metadata.DocumentationURL,
				BackstagePackage:    p.Metadata.BackstagePackage,
				RequiredConfigKeys:  p.Metadata.RequiredConfigKeys,
				SupportedFeatures:   p.Metadata.SupportedFeatures,
			},
			Status: &pluginsv1.PluginStatus{
				Healthy:        p.Status.Healthy,
				StatusMessage:  p.Status.StatusMessage,
				LastCheckedAt:  p.Status.LastCheckedAt.Unix(),
				RequestCount:   p.Status.RequestCount,
				ErrorCount:     p.Status.ErrorCount,
			},
		}
	}

	return &pluginsv1.ListPluginsResponse{
		Plugins: pbPlugins,
	}, nil
}

// GetPlugin returns details for a specific plugin
func (s *Server) GetPlugin(
	ctx context.Context,
	req *pluginsv1.GetPluginRequest,
) (*pluginsv1.GetPluginResponse, error) {
	// Validate request
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if req.PluginId == "" {
		return nil, status.Error(codes.InvalidArgument, "plugin_id is required")
	}

	// Validate workspace access
	if err := s.validateWorkspaceAccess(ctx, req.WorkspaceId); err != nil {
		return nil, err
	}

	// Get plugin from service
	plugin, err := s.pluginsService.GetPlugin(ctx, req.WorkspaceId, req.PluginId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "plugin not found: %v", err)
	}

	// Convert to protobuf
	return &pluginsv1.GetPluginResponse{
		Plugin: &pluginsv1.Plugin{
			Id:          plugin.ID,
			Name:        plugin.Name,
			Description: plugin.Description,
			Category:    plugin.Category,
			Enabled:     plugin.Enabled,
			ApiBasePath: plugin.APIBasePath,
			Config:      plugin.Config,
			Metadata: &pluginsv1.PluginMetadata{
				Version:             plugin.Metadata.Version,
				DocumentationUrl:    plugin.Metadata.DocumentationURL,
				BackstagePackage:    plugin.Metadata.BackstagePackage,
				RequiredConfigKeys:  plugin.Metadata.RequiredConfigKeys,
				SupportedFeatures:   plugin.Metadata.SupportedFeatures,
			},
			Status: &pluginsv1.PluginStatus{
				Healthy:        plugin.Status.Healthy,
				StatusMessage:  plugin.Status.StatusMessage,
				LastCheckedAt:  plugin.Status.LastCheckedAt.Unix(),
				RequestCount:   plugin.Status.RequestCount,
				ErrorCount:     plugin.Status.ErrorCount,
			},
		},
	}, nil
}

// ProxyPluginRequest proxies a request to Backstage backend
func (s *Server) ProxyPluginRequest(
	ctx context.Context,
	req *pluginsv1.ProxyPluginRequestMessage,
) (*pluginsv1.ProxyPluginResponse, error) {
	// Validate required fields
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if req.PluginId == "" {
		return nil, status.Error(codes.InvalidArgument, "plugin_id is required")
	}
	if req.EndpointPath == "" {
		return nil, status.Error(codes.InvalidArgument, "endpoint_path is required")
	}
	if req.HttpMethod == "" {
		req.HttpMethod = "GET" // Default to GET
	}

	// Validate workspace access
	if err := s.validateWorkspaceAccess(ctx, req.WorkspaceId); err != nil {
		return nil, err
	}

	// Call service layer
	response, err := s.pluginsService.ProxyPluginRequest(ctx, &service.ProxyRequest{
		WorkspaceID:  req.WorkspaceId,
		PluginID:     req.PluginId,
		EndpointPath: req.EndpointPath,
		Method:       req.HttpMethod,
		QueryParams:  req.QueryParams,
		Headers:      req.Headers,
		Body:         req.Body,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "proxy request failed: %v", err)
	}

	return &pluginsv1.ProxyPluginResponse{
		StatusCode:   int32(response.StatusCode),
		Data:         response.Data,
		Headers:      response.Headers,
		ErrorMessage: response.ErrorMessage,
		FromCache:    false, // TODO: Implement caching
	}, nil
}

// GetPluginSchema returns the schema for a plugin (stub for now)
func (s *Server) GetPluginSchema(
	ctx context.Context,
	req *pluginsv1.GetPluginSchemaRequest,
) (*pluginsv1.GetPluginSchemaResponse, error) {
	// TODO: Implement schema discovery
	return &pluginsv1.GetPluginSchemaResponse{
		JsonSchema: "{}",
		Endpoints:  []*pluginsv1.PluginEndpoint{},
	}, nil
}

// EnablePlugin enables a plugin for a workspace (stub for now)
func (s *Server) EnablePlugin(
	ctx context.Context,
	req *pluginsv1.EnablePluginRequest,
) (*pluginsv1.EnablePluginResponse, error) {
	// TODO: Implement via Payload CMS integration
	return &pluginsv1.EnablePluginResponse{
		Success: false,
		Message: "Not implemented - use Payload CMS admin UI",
	}, status.Error(codes.Unimplemented, "use Payload CMS admin UI to enable plugins")
}

// DisablePlugin disables a plugin for a workspace (stub for now)
func (s *Server) DisablePlugin(
	ctx context.Context,
	req *pluginsv1.DisablePluginRequest,
) (*pluginsv1.DisablePluginResponse, error) {
	// TODO: Implement via Payload CMS integration
	return &pluginsv1.DisablePluginResponse{
		Success: false,
		Message: "Not implemented - use Payload CMS admin UI",
	}, status.Error(codes.Unimplemented, "use Payload CMS admin UI to disable plugins")
}

// UpdatePluginConfig updates plugin configuration (stub for now)
func (s *Server) UpdatePluginConfig(
	ctx context.Context,
	req *pluginsv1.UpdatePluginConfigRequest,
) (*pluginsv1.UpdatePluginConfigResponse, error) {
	// TODO: Implement via Payload CMS integration
	return &pluginsv1.UpdatePluginConfigResponse{
		Success: false,
		Message: "Not implemented - use Payload CMS admin UI",
	}, status.Error(codes.Unimplemented, "use Payload CMS admin UI to update plugin config")
}

// validateWorkspaceAccess validates that the user has access to the workspace
func (s *Server) validateWorkspaceAccess(ctx context.Context, workspaceID string) error {
	// Extract JWT token from gRPC metadata
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "missing authentication metadata")
	}

	tokens := md.Get("authorization")
	if len(tokens) == 0 {
		// For MVP, allow requests without auth (development mode)
		// TODO: Remove this in production
		return nil
	}

	// Parse JWT and extract workspace claim
	token := strings.TrimPrefix(tokens[0], "Bearer ")
	claims, err := s.pluginsService.ValidateJWT(token)
	if err != nil {
		return status.Error(codes.Unauthenticated, "invalid token")
	}

	// Verify user has access to requested workspace
	if !claims.HasWorkspaceAccess(workspaceID) {
		return status.Error(codes.PermissionDenied, "access denied to workspace")
	}

	return nil
}
