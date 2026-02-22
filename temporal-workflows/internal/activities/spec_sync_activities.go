package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
)

// knownSpecFiles is the set of recognised spec file base names (all lowercase).
var knownSpecFiles = map[string]bool{
	"openapi.yaml":  true,
	"openapi.yml":   true,
	"openapi.json":  true,
	"swagger.yaml":  true,
	"swagger.yml":   true,
	"swagger.json":  true,
	"asyncapi.yaml": true,
	"asyncapi.yml":  true,
	"asyncapi.json": true,
}

// IsSpecFile returns true when the base name of path (case-insensitive) is a
// recognised API spec file name.
func IsSpecFile(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	return knownSpecFiles[base]
}

// DetectSpecType inspects content and returns "openapi", "asyncapi", or
// "unknown". It first attempts a JSON parse; if that fails it falls back to
// simple YAML line-prefix scanning.
func DetectSpecType(content string) string {
	// Try JSON first.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &obj); err == nil {
		if _, ok := obj["openapi"]; ok {
			return "openapi"
		}
		if _, ok := obj["swagger"]; ok {
			return "openapi"
		}
		if _, ok := obj["asyncapi"]; ok {
			return "asyncapi"
		}
		return "unknown"
	}

	// Fall back to YAML line-prefix scanning.
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "openapi:") || strings.HasPrefix(trimmed, "swagger:") {
			return "openapi"
		}
		if strings.HasPrefix(trimmed, "asyncapi:") {
			return "asyncapi"
		}
	}

	return "unknown"
}

// ---------------------------------------------------------------------------
// Types (defined here to avoid circular imports with the workflows package)
// ---------------------------------------------------------------------------

// SpecFileInfo describes a spec file discovered in a repository.
type SpecFileInfo struct {
	Path     string `json:"path"`
	SpecType string `json:"specType"` // "openapi", "asyncapi", or "unknown"
}

// UpsertSchemaInput contains the data needed to create or update an API schema
// in the catalog.
type UpsertSchemaInput struct {
	AppID          string `json:"appId"`
	WorkspaceID    string `json:"workspaceId"`
	FilePath       string `json:"filePath"`
	Content        string `json:"content"`
	SpecType       string `json:"specType"`
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
}

// UpsertSchemaResult contains the outcome of an upsert operation.
type UpsertSchemaResult struct {
	SchemaID string `json:"schemaId"`
	Created  bool   `json:"created"` // true if newly created, false if updated
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

// GitHubContentClient abstracts GitHub API operations needed by spec sync
// activities.
type GitHubContentClient interface {
	ListSpecFiles(ctx context.Context, repoFullName, installationID string) ([]SpecFileInfo, error)
	FetchFileContent(ctx context.Context, repoFullName, installationID, filePath string) (string, error)
}

// PayloadAPICatalogClient abstracts Payload CMS / API-catalog operations
// needed by spec sync activities.
type PayloadAPICatalogClient interface {
	UpsertAPISchema(ctx context.Context, input UpsertSchemaInput) (*UpsertSchemaResult, error)
	RemoveOrphanedSpecs(ctx context.Context, appID string, activePaths []string) error
}

// ---------------------------------------------------------------------------
// Activities struct
// ---------------------------------------------------------------------------

// SpecSyncActivities holds dependencies for spec-sync Temporal activities.
type SpecSyncActivities struct {
	github  GitHubContentClient
	catalog PayloadAPICatalogClient
	logger  *slog.Logger
}

// NewSpecSyncActivities creates a new SpecSyncActivities instance.
func NewSpecSyncActivities(github GitHubContentClient, catalog PayloadAPICatalogClient, logger *slog.Logger) *SpecSyncActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &SpecSyncActivities{
		github:  github,
		catalog: catalog,
		logger:  logger,
	}
}

// ---------------------------------------------------------------------------
// Activity methods
// ---------------------------------------------------------------------------

// ListRepoSpecFilesInput is the input for the ListRepoSpecFiles activity.
type ListRepoSpecFilesInput struct {
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
}

// ListRepoSpecFiles discovers API spec files in the given repository. It
// delegates to the GitHubContentClient and then filters the results through
// IsSpecFile to ensure only recognised file names are returned.
func (a *SpecSyncActivities) ListRepoSpecFiles(ctx context.Context, input ListRepoSpecFilesInput) ([]SpecFileInfo, error) {
	a.logger.Info("Listing repo spec files",
		"repoFullName", input.RepoFullName,
		"installationID", input.InstallationID)

	files, err := a.github.ListSpecFiles(ctx, input.RepoFullName, input.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("listing spec files: %w", err)
	}

	var filtered []SpecFileInfo
	for _, f := range files {
		if IsSpecFile(f.Path) {
			filtered = append(filtered, f)
		}
	}

	a.logger.Info("Found spec files", "total", len(files), "matched", len(filtered))
	return filtered, nil
}

// FetchSpecContentInput is the input for the FetchSpecContent activity.
type FetchSpecContentInput struct {
	RepoFullName   string `json:"repoFullName"`
	InstallationID string `json:"installationId"`
	FilePath       string `json:"filePath"`
}

// FetchSpecContent retrieves the raw content of a single spec file from
// GitHub.
func (a *SpecSyncActivities) FetchSpecContent(ctx context.Context, input FetchSpecContentInput) (string, error) {
	a.logger.Info("Fetching spec content",
		"repoFullName", input.RepoFullName,
		"filePath", input.FilePath)

	content, err := a.github.FetchFileContent(ctx, input.RepoFullName, input.InstallationID, input.FilePath)
	if err != nil {
		return "", fmt.Errorf("fetching file content for %s: %w", input.FilePath, err)
	}

	return content, nil
}

// UpsertAPISchemaToCatalog persists (create or update) an API schema in the
// catalog via the PayloadAPICatalogClient.
func (a *SpecSyncActivities) UpsertAPISchemaToCatalog(ctx context.Context, input UpsertSchemaInput) (*UpsertSchemaResult, error) {
	a.logger.Info("Upserting API schema to catalog",
		"appID", input.AppID,
		"filePath", input.FilePath,
		"specType", input.SpecType)

	result, err := a.catalog.UpsertAPISchema(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("upserting API schema for %s: %w", input.FilePath, err)
	}

	a.logger.Info("Upserted API schema",
		"schemaID", result.SchemaID,
		"created", result.Created)

	return result, nil
}

// RemoveOrphanedSpecsInput is the input for the RemoveOrphanedSpecs activity.
type RemoveOrphanedSpecsInput struct {
	AppID       string   `json:"appId"`
	ActivePaths []string `json:"activePaths"`
}

// RemoveOrphanedSpecs deletes API schemas from the catalog that no longer have
// a corresponding spec file in the repository.
func (a *SpecSyncActivities) RemoveOrphanedSpecs(ctx context.Context, input RemoveOrphanedSpecsInput) error {
	a.logger.Info("Removing orphaned specs",
		"appID", input.AppID,
		"activePathCount", len(input.ActivePaths))

	if err := a.catalog.RemoveOrphanedSpecs(ctx, input.AppID, input.ActivePaths); err != nil {
		return fmt.Errorf("removing orphaned specs for app %s: %w", input.AppID, err)
	}

	return nil
}
