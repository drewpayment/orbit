// services/build-service/internal/railpack/analyzer.go
package railpack

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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
	PackageManager  *PackageManagerInfo
}

// PackageManagerInfo holds package manager detection results
type PackageManagerInfo struct {
	Detected         bool
	Name             string // "npm", "yarn", "pnpm", "bun", or ""
	Source           string // "lockfile", "packageManager", "engines", ""
	Lockfile         string // actual lockfile found
	RequestedVersion string // version from packageManager field
	VersionSupported bool
	SupportedRange   string
}

// Analyzer handles Railpack-based project analysis
type Analyzer struct {
	logger *slog.Logger
}

// Supported version ranges
var supportedVersions = map[string]string{
	"npm":  ">=7.0.0",
	"yarn": ">=1.22.0",
	"pnpm": ">=7.0.0",
	"bun":  ">=1.0.0",
}

// lockfileToPackageManager maps lockfiles to package managers (priority order)
var lockfileToPackageManager = []struct {
	file string
	pm   string
}{
	{"pnpm-lock.yaml", "pnpm"},
	{"bun.lockb", "bun"},
	{"bun.lock", "bun"},
	{"yarn.lock", "yarn"},
	{"package-lock.json", "npm"},
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

	// Read package.json
	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return nil
	}

	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
		Scripts         map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	result := &AnalyzeResult{
		Detected:       true,
		Language:       "nodejs",
		DetectedFiles:  []string{"package.json"},
		PackageManager: a.detectPackageManager(projectDir),
	}

	// Detect Node.js version from .nvmrc
	if nvmrc, err := os.ReadFile(filepath.Join(projectDir, ".nvmrc")); err == nil {
		result.LanguageVersion = strings.TrimSpace(string(nvmrc))
		result.DetectedFiles = append(result.DetectedFiles, ".nvmrc")
	}

	// Detect framework (no longer setting build/start commands - let Railpack decide)
	if _, hasNext := pkg.Dependencies["next"]; hasNext {
		result.Framework = "nextjs"
	} else if _, hasReact := pkg.Dependencies["react"]; hasReact {
		result.Framework = "react"
	} else if _, hasExpress := pkg.Dependencies["express"]; hasExpress {
		result.Framework = "express"
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

func (a *Analyzer) detectPackageManager(projectDir string) *PackageManagerInfo {
	result := &PackageManagerInfo{
		VersionSupported: true, // Default to true unless we find an unsupported version
	}

	// Priority 1: Check packageManager field in package.json
	if pm, version := a.readPackageManagerField(projectDir); pm != "" {
		result.Detected = true
		result.Name = pm
		result.Source = "packageManager"
		result.RequestedVersion = version
		result.SupportedRange = supportedVersions[pm]
		result.VersionSupported = a.isVersionSupported(pm, version)
		return result
	}

	// Priority 2: Check lockfiles
	for _, lf := range lockfileToPackageManager {
		lockfilePath := filepath.Join(projectDir, lf.file)
		if _, err := os.Stat(lockfilePath); err == nil {
			result.Detected = true
			result.Name = lf.pm
			result.Source = "lockfile"
			result.Lockfile = lf.file
			result.SupportedRange = supportedVersions[lf.pm]
			return result
		}
	}

	// Not detected - workflow will need to ask user
	return result
}

func (a *Analyzer) readPackageManagerField(projectDir string) (pm string, version string) {
	packageJSONPath := filepath.Join(projectDir, "package.json")
	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return "", ""
	}

	var pkg struct {
		PackageManager string `json:"packageManager"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return "", ""
	}

	if pkg.PackageManager == "" {
		return "", ""
	}

	// Parse "npm@10.2.0" format
	parts := strings.SplitN(pkg.PackageManager, "@", 2)
	pm = parts[0]
	if len(parts) > 1 {
		version = parts[1]
		// Handle corepack hash suffix: "pnpm@8.0.0+sha256.abc..."
		if idx := strings.Index(version, "+"); idx != -1 {
			version = version[:idx]
		}
	}
	return pm, version
}

func (a *Analyzer) isVersionSupported(pm, version string) bool {
	if version == "" {
		return true // No version constraint specified
	}

	supportedRange, ok := supportedVersions[pm]
	if !ok {
		return true // Unknown package manager, allow it
	}

	// Parse minimum version from range like ">=7.0.0"
	minVersion := strings.TrimPrefix(supportedRange, ">=")

	// Simple semver comparison (major.minor.patch)
	return semverCompare(version, minVersion) >= 0
}

// semverCompare returns -1 if a < b, 0 if a == b, 1 if a > b
func semverCompare(a, b string) int {
	parseVersion := func(v string) (int, int, int) {
		parts := strings.Split(v, ".")
		major, minor, patch := 0, 0, 0
		if len(parts) >= 1 {
			major, _ = strconv.Atoi(parts[0])
		}
		if len(parts) >= 2 {
			minor, _ = strconv.Atoi(parts[1])
		}
		if len(parts) >= 3 {
			// Handle versions like "1.22.19" or "1.22.19-rc1"
			patchStr := parts[2]
			if idx := strings.IndexAny(patchStr, "-+"); idx != -1 {
				patchStr = patchStr[:idx]
			}
			patch, _ = strconv.Atoi(patchStr)
		}
		return major, minor, patch
	}

	aMajor, aMinor, aPatch := parseVersion(a)
	bMajor, bMinor, bPatch := parseVersion(b)

	if aMajor != bMajor {
		if aMajor < bMajor {
			return -1
		}
		return 1
	}
	if aMinor != bMinor {
		if aMinor < bMinor {
			return -1
		}
		return 1
	}
	if aPatch != bPatch {
		if aPatch < bPatch {
			return -1
		}
		return 1
	}
	return 0
}
