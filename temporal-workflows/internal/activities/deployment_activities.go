package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"text/template"
)

// EnvVarRef represents an environment variable reference (name only, no value)
type EnvVarRef struct {
	Key string
}

// GeneratorContext is the template rendering context passed to Go text/template
type GeneratorContext struct {
	ServiceName    string
	ImageRepo      string
	ImageTag       string
	Port           int
	HealthCheckURL string
	Replicas       int
	Namespace      string
	EnvVars        []EnvVarRef
}

// buildGeneratorContext creates a GeneratorContext from user config and env var refs
func buildGeneratorContext(config map[string]interface{}, envVars []EnvVarRef) GeneratorContext {
	ctx := GeneratorContext{
		ServiceName: "app",
		ImageTag:    "latest",
		Port:        3000,
		Replicas:    1,
		Namespace:   "default",
	}

	if sn, ok := config["serviceName"].(string); ok && sn != "" {
		ctx.ServiceName = sn
	} else if rn, ok := config["releaseName"].(string); ok && rn != "" {
		ctx.ServiceName = rn
	}
	if p, ok := config["port"].(float64); ok {
		ctx.Port = int(p)
	}
	if it, ok := config["imageTag"].(string); ok && it != "" {
		ctx.ImageTag = it
	}
	if ir, ok := config["imageRepository"].(string); ok && ir != "" {
		ctx.ImageRepo = ir
	}
	if r, ok := config["replicas"].(float64); ok {
		ctx.Replicas = int(r)
	}
	if ns, ok := config["namespace"].(string); ok && ns != "" {
		ctx.Namespace = ns
	}
	if hc, ok := config["healthCheckUrl"].(string); ok && hc != "" {
		ctx.HealthCheckURL = hc
	}

	// Default image repo if not provided
	if ctx.ImageRepo == "" {
		ctx.ImageRepo = fmt.Sprintf("ghcr.io/org/%s", ctx.ServiceName)
	}

	if len(envVars) > 0 {
		ctx.EnvVars = envVars
	}

	return ctx
}

// PayloadDeploymentClient defines interface for Payload CMS operations
type PayloadDeploymentClient interface {
	GetGeneratorBySlug(ctx context.Context, slug string) (*GeneratorData, error)
	UpdateDeploymentStatus(ctx context.Context, deploymentID, status, url, errorMsg string, generatedFiles []GeneratedFile) error
}

// GeneratorData represents a deployment generator from Payload
type GeneratorData struct {
	Name          string                  `json:"name"`
	Slug          string                  `json:"slug"`
	Type          string                  `json:"type"`
	ConfigSchema  json.RawMessage         `json:"configSchema"`
	TemplateFiles []GeneratorTemplateFile `json:"templateFiles"`
}

// GeneratorTemplateFile represents a template file in a generator
type GeneratorTemplateFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// DeploymentActivities holds dependencies for deployment activities
type DeploymentActivities struct {
	workDir       string
	payloadClient PayloadDeploymentClient
	logger        *slog.Logger
}

// NewDeploymentActivities creates a new instance
func NewDeploymentActivities(workDir string, payloadClient PayloadDeploymentClient, logger *slog.Logger) *DeploymentActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &DeploymentActivities{
		workDir:       workDir,
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// Activity input types (duplicated from workflows package to avoid circular dependency)
type ValidateDeploymentConfigInput struct {
	GeneratorType string `json:"generatorType"`
	Config        []byte `json:"config"`
}

type PrepareGeneratorContextInput struct {
	DeploymentID  string `json:"deploymentId"`
	AppID         string `json:"appId"`
	GeneratorSlug string `json:"generatorSlug"`
	Config        []byte `json:"config"`
}

type DeploymentTargetInput struct {
	Type    string `json:"type"`
	Region  string `json:"region,omitempty"`
	Cluster string `json:"cluster,omitempty"`
	HostURL string `json:"hostUrl,omitempty"`
}

type ExecuteGeneratorInput struct {
	DeploymentID  string                `json:"deploymentId"`
	GeneratorType string                `json:"generatorType"`
	GeneratorSlug string                `json:"generatorSlug"`
	WorkDir       string                `json:"workDir"`
	Target        DeploymentTargetInput `json:"target"`
	Mode          string                `json:"mode"` // "generate" or "execute"
}

type ExecuteGeneratorResult struct {
	Success        bool              `json:"success"`
	DeploymentURL  string            `json:"deploymentUrl"`
	Outputs        map[string]string `json:"outputs"`
	Error          string            `json:"error,omitempty"`
	GeneratedFiles []GeneratedFile   `json:"generatedFiles,omitempty"` // For generate mode
}

type UpdateDeploymentStatusInput struct {
	DeploymentID   string          `json:"deploymentId"`
	Status         string          `json:"status"`
	DeploymentURL  string          `json:"deploymentUrl,omitempty"`
	ErrorMessage   string          `json:"errorMessage,omitempty"`
	GeneratedFiles []GeneratedFile `json:"generatedFiles,omitempty"`
}

type CommitToRepoInput struct {
	DeploymentID  string          `json:"deploymentId"`
	AppID         string          `json:"appId"`
	WorkspaceID   string          `json:"workspaceId"`
	Files         []GeneratedFile `json:"files"`
	CommitMessage string          `json:"commitMessage"`
}

type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CommitToRepoResult struct {
	Success   bool   `json:"success"`
	CommitSHA string `json:"commitSha"`
	Error     string `json:"error,omitempty"`
}

// ValidateDeploymentConfig validates the deployment configuration
func (a *DeploymentActivities) ValidateDeploymentConfig(ctx context.Context, input ValidateDeploymentConfigInput) error {
	a.logger.Info("Validating deployment config", "generatorType", input.GeneratorType)

	var config map[string]interface{}
	if err := json.Unmarshal(input.Config, &config); err != nil {
		return fmt.Errorf("invalid JSON config: %w", err)
	}

	// Type-specific validation
	switch input.GeneratorType {
	case "docker-compose":
		return a.validateDockerComposeConfig(config)
	case "terraform":
		return a.validateTerraformConfig(config)
	case "helm":
		return a.validateHelmConfig(config)
	default:
		return fmt.Errorf("unsupported generator type: %s", input.GeneratorType)
	}
}

func (a *DeploymentActivities) validateDockerComposeConfig(config map[string]interface{}) error {
	// Required fields for generating docker-compose.yml
	// Image is derived from app's repository, so only serviceName is required
	required := []string{"serviceName"}
	var missing []string

	for _, field := range required {
		val, ok := config[field]
		if !ok {
			missing = append(missing, field)
			continue
		}
		// Check if value is an empty string
		if strVal, isString := val.(string); isString && strings.TrimSpace(strVal) == "" {
			missing = append(missing, field)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}

	return nil
}

func (a *DeploymentActivities) validateTerraformConfig(config map[string]interface{}) error {
	// Placeholder for terraform validation
	return nil
}

func (a *DeploymentActivities) validateHelmConfig(config map[string]interface{}) error {
	required := []string{"releaseName"}
	var missing []string

	for _, field := range required {
		val, ok := config[field]
		if !ok {
			missing = append(missing, field)
			continue
		}
		if strVal, isString := val.(string); isString && strings.TrimSpace(strVal) == "" {
			missing = append(missing, field)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}
	return nil
}

// PrepareGeneratorContext creates work directory and renders templates
func (a *DeploymentActivities) PrepareGeneratorContext(ctx context.Context, input PrepareGeneratorContextInput) (string, error) {
	a.logger.Info("Preparing generator context",
		"deploymentID", input.DeploymentID,
		"generatorSlug", input.GeneratorSlug)

	// Create work directory
	workDir := filepath.Join(a.workDir, fmt.Sprintf("deploy-%s", input.DeploymentID))
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create work directory: %w", err)
	}

	// Get generator from Payload
	if a.payloadClient == nil {
		// For now, use default docker-compose template if no client
		return a.prepareDefaultDockerCompose(workDir, input.Config)
	}

	generator, err := a.payloadClient.GetGeneratorBySlug(ctx, input.GeneratorSlug)
	if err != nil {
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("failed to get generator: %w", err)
	}

	// Parse config
	var config map[string]interface{}
	if err := json.Unmarshal(input.Config, &config); err != nil {
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("failed to parse config: %w", err)
	}

	// Render template files
	for _, tf := range generator.TemplateFiles {
		tmpl, err := template.New(tf.Path).Parse(tf.Content)
		if err != nil {
			_ = os.RemoveAll(workDir)
			return "", fmt.Errorf("failed to parse template %s: %w", tf.Path, err)
		}

		filePath := filepath.Join(workDir, tf.Path)
		f, err := os.Create(filePath)
		if err != nil {
			_ = os.RemoveAll(workDir)
			return "", fmt.Errorf("failed to create file %s: %w", tf.Path, err)
		}

		genCtx := buildGeneratorContext(config, nil) // TODO: fetch env vars from Payload in PrepareGeneratorContext
		if err := tmpl.Execute(f, genCtx); err != nil {
			f.Close()
			_ = os.RemoveAll(workDir)
			return "", fmt.Errorf("failed to render template %s: %w", tf.Path, err)
		}
		f.Close()
	}

	a.logger.Info("Generator context prepared", "workDir", workDir)
	return workDir, nil
}

func (a *DeploymentActivities) prepareDefaultDockerCompose(workDir string, configBytes []byte) (string, error) {
	var config map[string]interface{}
	if err := json.Unmarshal(configBytes, &config); err != nil {
		return "", fmt.Errorf("failed to parse config: %w", err)
	}

	genCtx := buildGeneratorContext(config, nil)

	composeContent := fmt.Sprintf(`services:
  %s:
    image: %s:%s
    ports:
      - "%d:%d"
    restart: unless-stopped
`, genCtx.ServiceName, genCtx.ImageRepo, genCtx.ImageTag, genCtx.Port, genCtx.Port)

	composePath := filepath.Join(workDir, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte(composeContent), 0644); err != nil {
		return "", fmt.Errorf("failed to write docker-compose.yml: %w", err)
	}

	return workDir, nil
}

// collectGeneratedFiles walks the work directory and returns all files with relative paths
func (a *DeploymentActivities) collectGeneratedFiles(workDir string) (*ExecuteGeneratorResult, error) {
	var files []GeneratedFile

	err := filepath.Walk(workDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(workDir, path)
		if err != nil {
			return err
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", relPath, err)
		}

		files = append(files, GeneratedFile{
			Path:    relPath,
			Content: string(content),
		})
		return nil
	})

	if err != nil {
		return &ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("failed to collect generated files: %v", err),
		}, nil
	}

	return &ExecuteGeneratorResult{
		Success:        true,
		GeneratedFiles: files,
		Outputs:        map[string]string{"mode": "generate", "fileCount": fmt.Sprintf("%d", len(files))},
	}, nil
}

// ExecuteGenerator runs the deployment generator
func (a *DeploymentActivities) ExecuteGenerator(ctx context.Context, input ExecuteGeneratorInput) (*ExecuteGeneratorResult, error) {
	a.logger.Info("Executing generator",
		"deploymentID", input.DeploymentID,
		"generatorType", input.GeneratorType,
		"mode", input.Mode,
		"workDir", input.WorkDir)

	// Generate mode: read all rendered files from work dir and return them
	if input.Mode == "generate" {
		return a.collectGeneratedFiles(input.WorkDir)
	}

	// Execute mode: only docker-compose supports this
	switch input.GeneratorType {
	case "docker-compose":
		return a.executeDockerCompose(ctx, input)
	default:
		return nil, fmt.Errorf("execute mode not supported for generator type: %s", input.GeneratorType)
	}
}

func (a *DeploymentActivities) executeDockerCompose(ctx context.Context, input ExecuteGeneratorInput) (*ExecuteGeneratorResult, error) {
	composeFilePath := filepath.Join(input.WorkDir, "docker-compose.yml")
	composeData, err := os.ReadFile(composeFilePath)
	if err != nil {
		return &ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("failed to read docker-compose.yml: %v", err),
		}, nil
	}

	// Generate mode: return the files without executing
	if input.Mode == "generate" {
		a.logger.Info("Docker Compose generate mode - returning files for commit")
		return a.collectGeneratedFiles(input.WorkDir)
	}

	// Execute mode: run docker compose (existing behavior)
	a.logger.Info("Docker Compose execute mode - running docker compose up")

	// Extract port from docker-compose file
	port := 3000
	lines := strings.Split(string(composeData), "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- \"") && strings.Contains(trimmed, ":") {
			portStr := strings.TrimPrefix(trimmed, "- \"")
			portStr = strings.TrimSuffix(portStr, "\"")
			parts := strings.Split(portStr, ":")
			if len(parts) == 2 {
				if p, err := strconv.Atoi(parts[0]); err == nil {
					port = p
				}
			}
			break
		}
	}

	// Build docker-compose command
	args := []string{"compose", "-f", composeFilePath}
	if input.Target.HostURL != "" {
		args = append([]string{"-H", input.Target.HostURL}, args...)
	}
	args = append(args, "up", "-d")

	cmd := exec.CommandContext(ctx, "docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		a.logger.Error("Docker compose failed", "error", err, "output", string(output))
		return &ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("docker compose failed: %s", string(output)),
		}, nil
	}

	deploymentURL := fmt.Sprintf("http://localhost:%d", port)
	if input.Target.HostURL != "" && !strings.HasPrefix(input.Target.HostURL, "unix://") {
		host := strings.TrimPrefix(input.Target.HostURL, "ssh://")
		host = strings.TrimPrefix(host, "tcp://")
		if idx := strings.Index(host, "@"); idx != -1 {
			host = host[idx+1:]
		}
		if idx := strings.Index(host, ":"); idx != -1 {
			host = host[:idx]
		}
		deploymentURL = fmt.Sprintf("http://%s:%d", host, port)
	}

	return &ExecuteGeneratorResult{
		Success:       true,
		DeploymentURL: deploymentURL,
		Outputs:       map[string]string{"compose_output": string(output)},
	}, nil
}

// UpdateDeploymentStatus updates the deployment status in Payload
func (a *DeploymentActivities) UpdateDeploymentStatus(ctx context.Context, input UpdateDeploymentStatusInput) error {
	a.logger.Info("Updating deployment status",
		"deploymentID", input.DeploymentID,
		"status", input.Status,
		"filesCount", len(input.GeneratedFiles))

	if a.payloadClient == nil {
		// Log and return success if no client (for testing)
		a.logger.Warn("No Payload client configured, skipping status update")
		return nil
	}

	return a.payloadClient.UpdateDeploymentStatus(
		ctx,
		input.DeploymentID,
		input.Status,
		input.DeploymentURL,
		input.ErrorMessage,
		input.GeneratedFiles,
	)
}

// CommitToRepo commits generated files to the app's repository
func (a *DeploymentActivities) CommitToRepo(ctx context.Context, input CommitToRepoInput) (*CommitToRepoResult, error) {
	a.logger.Info("Committing files to repository",
		"deploymentID", input.DeploymentID,
		"appID", input.AppID,
		"fileCount", len(input.Files))

	// For now, return success - will implement GitHub commit in next task
	// This is a placeholder that allows the workflow to complete
	return &CommitToRepoResult{
		Success:   true,
		CommitSHA: "placeholder-sha",
	}, nil
}
