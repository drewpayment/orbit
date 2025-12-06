// services/build-service/internal/railpack/analyzer.go
package railpack

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// AnalyzeResult contains the results of Railpack analysis
type AnalyzeResult struct {
	Detected        bool
	Language        string
	LanguageVersion string
	Framework       string
	BuildCommand    string
	StartCommand    string
	DetectedFiles   []string
	Error           string
}

// Analyzer handles Railpack-based project analysis
type Analyzer struct {
	logger *slog.Logger
}

// NewAnalyzer creates a new Analyzer instance
func NewAnalyzer(logger *slog.Logger) *Analyzer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Analyzer{logger: logger}
}

// Analyze detects the project type and build configuration
func (a *Analyzer) Analyze(ctx context.Context, projectDir string) (*AnalyzeResult, error) {
	// Validate input
	if projectDir == "" {
		return nil, os.ErrInvalid
	}
	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		return nil, err
	}

	a.logger.Info("Analyzing project", "dir", projectDir)

	// Try Railpack CLI first if available
	result, err := a.tryRailpackCLI(ctx, projectDir)
	if err == nil && result.Detected {
		return result, nil
	}

	// Fallback to manual detection
	return a.detectManually(projectDir)
}

// tryRailpackCLI attempts to use the Railpack CLI for detection
func (a *Analyzer) tryRailpackCLI(ctx context.Context, projectDir string) (*AnalyzeResult, error) {
	// Check if railpack is available
	_, err := exec.LookPath("railpack")
	if err != nil {
		a.logger.Debug("Railpack CLI not found, using manual detection")
		return nil, err
	}

	// Run railpack build --plan to get the build plan without building
	cmd := exec.CommandContext(ctx, "railpack", "build", "--plan", "--json", projectDir)
	output, err := cmd.Output()
	if err != nil {
		a.logger.Debug("Railpack CLI failed", "error", err)
		return nil, err
	}

	// Parse Railpack output
	var planOutput struct {
		Provider string `json:"provider"`
		Version  string `json:"version"`
	}
	if err := json.Unmarshal(output, &planOutput); err != nil {
		return nil, err
	}

	return &AnalyzeResult{
		Detected:        true,
		Language:        planOutput.Provider,
		LanguageVersion: planOutput.Version,
	}, nil
}

// detectManually performs manual detection based on file presence
func (a *Analyzer) detectManually(projectDir string) (*AnalyzeResult, error) {
	result := &AnalyzeResult{
		Detected:      false,
		DetectedFiles: []string{},
	}

	// Check for Node.js
	if nodeResult := a.detectNodeJS(projectDir); nodeResult != nil {
		return nodeResult, nil
	}

	// Check for Python
	if pythonResult := a.detectPython(projectDir); pythonResult != nil {
		return pythonResult, nil
	}

	// Check for Go
	if goResult := a.detectGo(projectDir); goResult != nil {
		return goResult, nil
	}

	// Check for Dockerfile (fallback)
	if dockerResult := a.detectDockerfile(projectDir); dockerResult != nil {
		return dockerResult, nil
	}

	result.Error = "Could not detect project type. Please add a Dockerfile to your repository."
	return result, nil
}

func (a *Analyzer) detectNodeJS(projectDir string) *AnalyzeResult {
	packageJSONPath := filepath.Join(projectDir, "package.json")
	if _, err := os.Stat(packageJSONPath); os.IsNotExist(err) {
		return nil
	}

	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return nil
	}

	var pkg struct {
		Scripts      map[string]string `json:"scripts"`
		Dependencies map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	result := &AnalyzeResult{
		Detected:      true,
		Language:      "nodejs",
		DetectedFiles: []string{"package.json"},
	}

	// Detect framework
	if _, hasNext := pkg.Dependencies["next"]; hasNext {
		result.Framework = "nextjs"
		result.BuildCommand = "npm run build"
		result.StartCommand = "npm start"
	} else if _, hasReact := pkg.Dependencies["react"]; hasReact {
		result.Framework = "react"
		result.BuildCommand = "npm run build"
		result.StartCommand = "npm start"
	} else if _, hasExpress := pkg.Dependencies["express"]; hasExpress {
		result.Framework = "express"
		result.StartCommand = "npm start"
	} else {
		// Generic Node.js
		if _, hasBuild := pkg.Scripts["build"]; hasBuild {
			result.BuildCommand = "npm run build"
		}
		if _, hasStart := pkg.Scripts["start"]; hasStart {
			result.StartCommand = "npm start"
		}
	}

	// Detect Node version from .nvmrc or engines
	nvmrcPath := filepath.Join(projectDir, ".nvmrc")
	if nvmrcData, err := os.ReadFile(nvmrcPath); err == nil {
		result.LanguageVersion = strings.TrimSpace(string(nvmrcData))
		result.DetectedFiles = append(result.DetectedFiles, ".nvmrc")
	}

	return result
}

func (a *Analyzer) detectPython(projectDir string) *AnalyzeResult {
	// Check for various Python project indicators
	indicators := []string{
		"requirements.txt",
		"pyproject.toml",
		"setup.py",
		"Pipfile",
	}

	var detectedFile string
	for _, indicator := range indicators {
		path := filepath.Join(projectDir, indicator)
		if _, err := os.Stat(path); err == nil {
			detectedFile = indicator
			break
		}
	}

	if detectedFile == "" {
		return nil
	}

	result := &AnalyzeResult{
		Detected:        true,
		Language:        "python",
		LanguageVersion: "3.12", // Default
		DetectedFiles:   []string{detectedFile},
	}

	// Check for FastAPI/Flask/Django
	reqPath := filepath.Join(projectDir, "requirements.txt")
	if data, err := os.ReadFile(reqPath); err == nil {
		content := strings.ToLower(string(data))
		if strings.Contains(content, "fastapi") {
			result.Framework = "fastapi"
			result.StartCommand = "uvicorn main:app --host 0.0.0.0 --port 8000"
		} else if strings.Contains(content, "flask") {
			result.Framework = "flask"
			result.StartCommand = "flask run --host 0.0.0.0"
		} else if strings.Contains(content, "django") {
			result.Framework = "django"
			result.StartCommand = "python manage.py runserver 0.0.0.0:8000"
		}
	}

	// Check for .python-version
	pvPath := filepath.Join(projectDir, ".python-version")
	if pvData, err := os.ReadFile(pvPath); err == nil {
		result.LanguageVersion = strings.TrimSpace(string(pvData))
		result.DetectedFiles = append(result.DetectedFiles, ".python-version")
	}

	return result
}

func (a *Analyzer) detectGo(projectDir string) *AnalyzeResult {
	goModPath := filepath.Join(projectDir, "go.mod")
	if _, err := os.Stat(goModPath); os.IsNotExist(err) {
		return nil
	}

	result := &AnalyzeResult{
		Detected:        true,
		Language:        "go",
		LanguageVersion: "1.22", // Default
		BuildCommand:    "go build -o app .",
		StartCommand:    "./app",
		DetectedFiles:   []string{"go.mod"},
	}

	// Parse go.mod for version
	if data, err := os.ReadFile(goModPath); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "go ") {
				result.LanguageVersion = strings.TrimSpace(strings.TrimPrefix(line, "go "))
				break
			}
		}
	}

	return result
}

func (a *Analyzer) detectDockerfile(projectDir string) *AnalyzeResult {
	dockerfilePath := filepath.Join(projectDir, "Dockerfile")
	if _, err := os.Stat(dockerfilePath); os.IsNotExist(err) {
		return nil
	}

	return &AnalyzeResult{
		Detected:      true,
		Language:      "dockerfile",
		DetectedFiles: []string{"Dockerfile"},
	}
}
