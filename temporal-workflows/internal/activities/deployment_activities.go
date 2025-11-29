package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
)

// PayloadDeploymentClient defines interface for Payload CMS operations
type PayloadDeploymentClient interface {
	GetGeneratorBySlug(ctx context.Context, slug string) (*GeneratorData, error)
	UpdateDeploymentStatus(ctx context.Context, deploymentID, status, url, errorMsg string) error
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
	WorkDir       string                `json:"workDir"`
	Target        DeploymentTargetInput `json:"target"`
}

type ExecuteGeneratorResult struct {
	Success       bool              `json:"success"`
	DeploymentURL string            `json:"deploymentUrl"`
	Outputs       map[string]string `json:"outputs"`
	Error         string            `json:"error,omitempty"`
}

type UpdateDeploymentStatusInput struct {
	DeploymentID  string `json:"deploymentId"`
	Status        string `json:"status"`
	DeploymentURL string `json:"deploymentUrl,omitempty"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
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
	required := []string{"hostUrl", "serviceName"}
	var missing []string

	for _, field := range required {
		if _, ok := config[field]; !ok {
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
	// Placeholder for helm validation
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

		if err := tmpl.Execute(f, config); err != nil {
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

	serviceName := "app"
	if sn, ok := config["serviceName"].(string); ok {
		serviceName = sn
	}

	port := 3000
	if p, ok := config["port"].(float64); ok {
		port = int(p)
	}

	imageTag := "latest"
	if it, ok := config["imageTag"].(string); ok {
		imageTag = it
	}

	imageRepo := "your-image"
	if ir, ok := config["imageRepository"].(string); ok {
		imageRepo = ir
	}

	composeContent := fmt.Sprintf(`version: '3.8'

services:
  %s:
    image: %s:%s
    ports:
      - "%d:%d"
    restart: unless-stopped
`, serviceName, imageRepo, imageTag, port, port)

	composePath := filepath.Join(workDir, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte(composeContent), 0644); err != nil {
		return "", fmt.Errorf("failed to write docker-compose.yml: %w", err)
	}

	return workDir, nil
}

// ExecuteGenerator runs the deployment generator
func (a *DeploymentActivities) ExecuteGenerator(ctx context.Context, input ExecuteGeneratorInput) (*ExecuteGeneratorResult, error) {
	a.logger.Info("Executing generator",
		"deploymentID", input.DeploymentID,
		"generatorType", input.GeneratorType,
		"workDir", input.WorkDir)

	switch input.GeneratorType {
	case "docker-compose":
		return a.executeDockerCompose(ctx, input)
	case "terraform":
		return nil, errors.New("terraform generator not implemented")
	case "helm":
		return nil, errors.New("helm generator not implemented")
	default:
		return nil, fmt.Errorf("unsupported generator type: %s", input.GeneratorType)
	}
}

func (a *DeploymentActivities) executeDockerCompose(ctx context.Context, input ExecuteGeneratorInput) (*ExecuteGeneratorResult, error) {
	// Build docker-compose command
	args := []string{"compose", "-f", filepath.Join(input.WorkDir, "docker-compose.yml")}

	// Add host if specified
	if input.Target.HostURL != "" {
		args = append([]string{"-H", input.Target.HostURL}, args...)
	}

	args = append(args, "up", "-d")

	cmd := exec.CommandContext(ctx, "docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		a.logger.Error("Docker compose failed",
			"error", err,
			"output", string(output))
		return &ExecuteGeneratorResult{
			Success: false,
			Error:   fmt.Sprintf("docker compose failed: %s", string(output)),
		}, nil
	}

	a.logger.Info("Docker compose executed successfully")

	// For local deployments, return localhost URL
	deploymentURL := "http://localhost:3000"
	if input.Target.HostURL != "" && !strings.HasPrefix(input.Target.HostURL, "unix://") {
		// Extract host from URL
		host := strings.TrimPrefix(input.Target.HostURL, "ssh://")
		host = strings.TrimPrefix(host, "tcp://")
		if idx := strings.Index(host, "@"); idx != -1 {
			host = host[idx+1:]
		}
		if idx := strings.Index(host, ":"); idx != -1 {
			host = host[:idx]
		}
		deploymentURL = fmt.Sprintf("http://%s:3000", host)
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
		"status", input.Status)

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
	)
}
