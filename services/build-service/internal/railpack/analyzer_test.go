// services/build-service/internal/railpack/analyzer_test.go
package railpack

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAnalyzer_DetectsNodeJS(t *testing.T) {
	// Create a temporary directory with a package.json
	tmpDir := t.TempDir()
	packageJSON := `{
		"name": "test-app",
		"version": "1.0.0",
		"scripts": {
			"build": "next build",
			"start": "next start"
		},
		"dependencies": {
			"next": "^14.0.0"
		}
	}`
	err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(packageJSON), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "nodejs", result.Language)
	require.Equal(t, "nextjs", result.Framework)
}

func TestAnalyzer_DetectsPython(t *testing.T) {
	tmpDir := t.TempDir()
	requirements := `fastapi==0.104.0
uvicorn==0.24.0
`
	err := os.WriteFile(filepath.Join(tmpDir, "requirements.txt"), []byte(requirements), 0644)
	require.NoError(t, err)

	mainPy := `from fastapi import FastAPI
app = FastAPI()
`
	err = os.WriteFile(filepath.Join(tmpDir, "main.py"), []byte(mainPy), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "python", result.Language)
}

func TestAnalyzer_ReturnsNotDetectedForUnknown(t *testing.T) {
	tmpDir := t.TempDir()
	// Empty directory - nothing to detect

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.False(t, result.Detected)
	require.NotEmpty(t, result.Error)
}

func TestAnalyzer_DetectsGoWithVersion(t *testing.T) {
	tmpDir := t.TempDir()
	goMod := `module github.com/test/app

go 1.21

require (
	github.com/stretchr/testify v1.8.4
)
`
	err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte(goMod), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "go", result.Language)
	require.Equal(t, "1.21", result.LanguageVersion)
	require.Equal(t, "go build -o app .", result.BuildCommand)
	require.Equal(t, "./app", result.StartCommand)
	require.Contains(t, result.DetectedFiles, "go.mod")
}

func TestAnalyzer_DetectsDockerfile(t *testing.T) {
	tmpDir := t.TempDir()
	dockerfile := `FROM node:18
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "start"]
`
	err := os.WriteFile(filepath.Join(tmpDir, "Dockerfile"), []byte(dockerfile), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "dockerfile", result.Language)
	require.Contains(t, result.DetectedFiles, "Dockerfile")
}

func TestAnalyzer_DetectsNodeVersionFromNvmrc(t *testing.T) {
	tmpDir := t.TempDir()
	packageJSON := `{
		"name": "test-app",
		"version": "1.0.0",
		"dependencies": {
			"express": "^4.18.0"
		}
	}`
	err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(packageJSON), 0644)
	require.NoError(t, err)

	nvmrc := "18.20.2\n"
	err = os.WriteFile(filepath.Join(tmpDir, ".nvmrc"), []byte(nvmrc), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	require.NoError(t, err)
	require.True(t, result.Detected)
	require.Equal(t, "nodejs", result.Language)
	require.Equal(t, "18.20.2", result.LanguageVersion)
	require.Contains(t, result.DetectedFiles, "package.json")
	require.Contains(t, result.DetectedFiles, ".nvmrc")
}

func TestAnalyzer_HandlesMalformedPackageJSON(t *testing.T) {
	tmpDir := t.TempDir()
	malformedJSON := `{
		"name": "test-app",
		"version": "1.0.0"
		// missing closing brace and has comment
	`
	err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(malformedJSON), 0644)
	require.NoError(t, err)

	analyzer := NewAnalyzer(slog.Default())
	result, err := analyzer.Analyze(context.Background(), tmpDir)

	// Should fallback to other detectors or return not detected
	require.NoError(t, err)
	require.False(t, result.Detected)
}

func TestAnalyzer_ValidatesInput(t *testing.T) {
	analyzer := NewAnalyzer(slog.Default())

	t.Run("empty path", func(t *testing.T) {
		result, err := analyzer.Analyze(context.Background(), "")
		require.Error(t, err)
		require.Nil(t, result)
		require.Equal(t, os.ErrInvalid, err)
	})

	t.Run("non-existent path", func(t *testing.T) {
		result, err := analyzer.Analyze(context.Background(), "/nonexistent/path/that/does/not/exist")
		require.Error(t, err)
		require.Nil(t, result)
		require.True(t, os.IsNotExist(err))
	})
}

func TestAnalyzer_DetectsPackageManagerFromLockfile(t *testing.T) {
	tests := []struct {
		name         string
		lockfile     string
		wantPM       string
		wantSource   string
		wantDetected bool
	}{
		{"npm from package-lock.json", "package-lock.json", "npm", "lockfile", true},
		{"yarn from yarn.lock", "yarn.lock", "yarn", "lockfile", true},
		{"pnpm from pnpm-lock.yaml", "pnpm-lock.yaml", "pnpm", "lockfile", true},
		{"bun from bun.lockb", "bun.lockb", "bun", "lockfile", true},
		{"bun from bun.lock", "bun.lock", "bun", "lockfile", true},
		{"no lockfile", "", "", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()

			// Create package.json (required for Node.js detection)
			err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte(`{"name": "test"}`), 0644)
			require.NoError(t, err)

			// Create lockfile if specified
			if tt.lockfile != "" {
				err := os.WriteFile(filepath.Join(tmpDir, tt.lockfile), []byte(""), 0644)
				require.NoError(t, err)
			}

			analyzer := NewAnalyzer(slog.Default())
			result, err := analyzer.Analyze(context.Background(), tmpDir)

			require.NoError(t, err)
			require.NotNil(t, result.PackageManager)
			assert.Equal(t, tt.wantDetected, result.PackageManager.Detected)
			assert.Equal(t, tt.wantPM, result.PackageManager.Name)
			assert.Equal(t, tt.wantSource, result.PackageManager.Source)
		})
	}
}
