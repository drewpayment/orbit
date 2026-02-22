# Deployment Generators Phase 2.3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the deployment generators feature end-to-end — fix template rendering, add Helm chart generator, wire CommitToRepo with GitHub, fix UI gaps, add secret reference injection.

**Architecture:** The scaffolding is extensive (collections, Temporal workflow, gRPC service, UI components). This plan fills in the real implementations: production-quality Go `text/template` templates, GitHub Trees API commits, env var reference injection, and generator-specific UI config fields. All generators use "generate mode" — files are rendered for user review and optional commit to repo.

**Tech Stack:** Go text/template (rendering), Temporal (orchestration), GitHub Trees API (commits), Payload CMS (data), Next.js server actions (UI), Octokit (GitHub client)

---

## Task 1: Fix Seed Template Syntax and Improve Docker Compose Template

The seed data uses Handlebars syntax (`{{serviceName}}`), but the Go activity renders with `text/template` (`{{.ServiceName}}`). Fix the seed and improve the Docker Compose template quality.

**Files:**
- Modify: `orbit-www/src/lib/seeds/deployment-generators.ts`
- Modify: `orbit-www/src/app/api/seed-generators/route.ts` (if exists — verify idempotent upsert)

**Step 1: Rewrite the seed template**

In `orbit-www/src/lib/seeds/deployment-generators.ts`, replace the entire `builtInGenerators` array:

```typescript
export const builtInGenerators = [
  {
    name: 'Docker Compose (Basic)',
    slug: 'docker-compose-basic',
    description: 'Generate a docker-compose.yml for local or remote Docker deployment',
    type: 'docker-compose' as const,
    isBuiltIn: true,
    configSchema: {
      type: 'object',
      required: ['serviceName'],
      properties: {
        serviceName: {
          type: 'string',
          description: 'Service name in the compose file',
        },
        port: {
          type: 'number',
          description: 'Port to expose (default: 3000)',
          default: 3000,
        },
      },
    },
    templateFiles: [
      {
        path: 'docker-compose.yml',
        content: `services:
  {{.ServiceName}}:
    image: {{.ImageRepo}}:{{.ImageTag}}
    ports:
      - "{{.Port}}:{{.Port}}"
    restart: unless-stopped{{if .EnvVars}}
    environment:{{range .EnvVars}}
      {{.Key}}: \${{"{{"}}{{.Key}}{{"}}"}}{{end}}{{end}}{{if .HealthCheckURL}}
    healthcheck:
      test: ["CMD", "curl", "-f", "{{.HealthCheckURL}}"]
      interval: 30s
      timeout: 10s
      retries: 3{{end}}
`,
      },
    ],
  },
]
```

Note: The `configSchema` no longer requires `hostUrl` or `envVars` — those are derived from the app's data by the Go activity. The `serviceName` and `port` are the only user-provided config fields.

**Step 2: Verify the seed route still works**

Check `orbit-www/src/app/api/seed-generators/route.ts` exists and does upsert (find-by-slug, update or create). No changes needed if it already does this.

**Step 3: Commit**

```bash
git add orbit-www/src/lib/seeds/deployment-generators.ts
git commit -m "fix(deployment): rewrite seed template to use Go text/template syntax"
```

---

## Task 2: Add Helm Chart Seed Generator

Add a built-in Helm chart generator with 4 template files.

**Files:**
- Modify: `orbit-www/src/lib/seeds/deployment-generators.ts`

**Step 1: Add Helm generator to the builtInGenerators array**

Append to the array in `orbit-www/src/lib/seeds/deployment-generators.ts`:

```typescript
  {
    name: 'Helm Chart (Basic)',
    slug: 'helm-basic',
    description: 'Generate a Helm chart for Kubernetes deployment',
    type: 'helm' as const,
    isBuiltIn: true,
    configSchema: {
      type: 'object',
      required: ['releaseName'],
      properties: {
        releaseName: {
          type: 'string',
          description: 'Helm release name',
        },
        namespace: {
          type: 'string',
          description: 'Kubernetes namespace (default: default)',
          default: 'default',
        },
        replicas: {
          type: 'number',
          description: 'Number of replicas (default: 1)',
          default: 1,
        },
        port: {
          type: 'number',
          description: 'Container port (default: 3000)',
          default: 3000,
        },
      },
    },
    templateFiles: [
      {
        path: 'Chart.yaml',
        content: `apiVersion: v2
name: {{.ServiceName}}
description: Helm chart for {{.ServiceName}}
type: application
version: 0.1.0
appVersion: "{{.ImageTag}}"
`,
      },
      {
        path: 'values.yaml',
        content: `replicaCount: {{.Replicas}}

image:
  repository: {{.ImageRepo}}
  tag: "{{.ImageTag}}"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: {{.Port}}

resources:
  limits:
    cpu: 500m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
{{if .EnvVars}}
env:{{range .EnvVars}}
  {{.Key}}: ""  # Set via --set or values override{{end}}
{{end}}`,
      },
      {
        path: 'templates/deployment.yaml',
        content: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{"{{"}} include "chart.fullname" . {{"}}"}}
  labels:
    app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
spec:
  replicas: {{"{{"}} .Values.replicaCount {{"}}"}}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
    spec:
      containers:
        - name: {{"{{"}} .Chart.Name {{"}}"}}
          image: "{{"{{"}} .Values.image.repository {{"}}"}}:{{"{{"}} .Values.image.tag {{"}}"}}{{"{{"}}"}}"}}
          ports:
            - containerPort: {{"{{"}} .Values.service.port {{"}}"}}{{if .EnvVars}}
          env:{{range .EnvVars}}
            - name: {{.Key}}
              valueFrom:
                secretKeyRef:
                  name: {{"{{"}} include "chart.fullname" . {{"}}"}}}}-secrets
                  key: {{.Key}}{{end}}{{end}}
          resources:
            {{"{{"}}- toYaml .Values.resources | nindent 12 {{"}}"}}
`,
      },
      {
        path: 'templates/service.yaml',
        content: `apiVersion: v1
kind: Service
metadata:
  name: {{"{{"}} include "chart.fullname" . {{"}}"}}
spec:
  type: {{"{{"}} .Values.service.type {{"}}"}}
  ports:
    - port: {{"{{"}} .Values.service.port {{"}}"}}
      targetPort: {{"{{"}} .Values.service.port {{"}}"}}
      protocol: TCP
  selector:
    app.kubernetes.io/name: {{"{{"}} include "chart.name" . {{"}}"}}
`,
      },
      {
        path: 'templates/_helpers.tpl',
        content: `{{"{{"}}/*
Chart helper templates
*/{{"}}"}}

{{"{{"}}- define "chart.name" -{{"}}"}}
{{"{{"}}- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" {{"}}"}}
{{"{{"}}- end {{"}}"}}

{{"{{"}}- define "chart.fullname" -{{"}}"}}
{{"{{"}}- if .Values.fullnameOverride {{"}}"}}
{{"{{"}}- .Values.fullnameOverride | trunc 63 | trimSuffix "-" {{"}}"}}
{{"{{"}}- else {{"}}"}}
{{"{{"}}- .Chart.Name | trunc 63 | trimSuffix "-" {{"}}"}}
{{"{{"}}- end {{"}}"}}
{{"{{"}}- end {{"}}"}}
`,
      },
    ],
  },
```

**Important note on Helm templates:** The Helm chart files contain Helm's own `{{ }}` template delimiters. Since the Go `text/template` engine also uses `{{ }}`, we must escape the Helm delimiters so they pass through the Go renderer untouched. The pattern `{{"{{"}}` outputs a literal `{{` and `{{"}}"}}` outputs a literal `}}`. The Go-level variables like `{{.ServiceName}}`, `{{.ImageRepo}}`, `{{.Port}}`, `{{range .EnvVars}}` etc. are rendered by Go. Everything else passes through as literal Helm syntax.

**Step 2: Commit**

```bash
git add orbit-www/src/lib/seeds/deployment-generators.ts
git commit -m "feat(deployment): add Helm chart seed generator"
```

---

## Task 3: Add Env Var Injection and Improve PrepareGeneratorContext

The Go activity currently uses a flat `map[string]interface{}` config for template rendering. We need a proper `GeneratorContext` struct that includes env var names fetched from Payload.

**Files:**
- Modify: `temporal-workflows/internal/activities/deployment_activities.go`
- Create: `temporal-workflows/internal/activities/deployment_activities_envvars_test.go`

**Step 1: Write the test for GeneratorContext building**

Create `temporal-workflows/internal/activities/deployment_activities_envvars_test.go`:

```go
package activities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildGeneratorContext(t *testing.T) {
	tests := []struct {
		name     string
		config   map[string]interface{}
		envVars  []EnvVarRef
		expected GeneratorContext
	}{
		{
			name: "docker-compose with env vars",
			config: map[string]interface{}{
				"serviceName": "my-app",
				"port":        float64(8080),
			},
			envVars: []EnvVarRef{
				{Key: "DATABASE_URL"},
				{Key: "API_KEY"},
			},
			expected: GeneratorContext{
				ServiceName:    "my-app",
				ImageRepo:      "ghcr.io/org/my-app",
				ImageTag:       "latest",
				Port:           8080,
				HealthCheckURL: "",
				Replicas:       1,
				Namespace:      "default",
				EnvVars: []EnvVarRef{
					{Key: "DATABASE_URL"},
					{Key: "API_KEY"},
				},
			},
		},
		{
			name: "helm with custom values",
			config: map[string]interface{}{
				"releaseName": "my-release",
				"namespace":   "production",
				"replicas":    float64(3),
				"port":        float64(9090),
			},
			envVars: nil,
			expected: GeneratorContext{
				ServiceName:    "my-release",
				ImageRepo:      "ghcr.io/org/my-release",
				ImageTag:       "latest",
				Port:           9090,
				HealthCheckURL: "",
				Replicas:       3,
				Namespace:      "production",
				EnvVars:        nil,
			},
		},
		{
			name:   "defaults when config is minimal",
			config: map[string]interface{}{},
			expected: GeneratorContext{
				ServiceName:    "app",
				ImageRepo:      "ghcr.io/org/app",
				ImageTag:       "latest",
				Port:           3000,
				HealthCheckURL: "",
				Replicas:       1,
				Namespace:      "default",
				EnvVars:        nil,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := buildGeneratorContext(tc.config, tc.envVars)
			require.Equal(t, tc.expected.ServiceName, result.ServiceName)
			require.Equal(t, tc.expected.Port, result.Port)
			require.Equal(t, tc.expected.Replicas, result.Replicas)
			require.Equal(t, tc.expected.Namespace, result.Namespace)
			require.Equal(t, tc.expected.EnvVars, result.EnvVars)
		})
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -race -run TestBuildGeneratorContext ./internal/activities/`
Expected: FAIL (function not defined)

**Step 3: Add GeneratorContext struct and builder to deployment_activities.go**

Add these types and the builder function to `temporal-workflows/internal/activities/deployment_activities.go`:

```go
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
	}
	if rn, ok := config["releaseName"].(string); ok && rn != "" {
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
```

**Step 4: Run test to verify it passes**

Run: `cd temporal-workflows && go test -v -race -run TestBuildGeneratorContext ./internal/activities/`
Expected: PASS

**Step 5: Update PrepareGeneratorContext to use GeneratorContext**

Modify the `PrepareGeneratorContext` method to use `buildGeneratorContext` instead of the raw config map. Also update `prepareDefaultDockerCompose` to use the same struct. The key change in the template rendering:

Replace the line:
```go
if err := tmpl.Execute(f, config); err != nil {
```

With:
```go
genCtx := buildGeneratorContext(config, nil) // TODO: fetch env vars from Payload
if err := tmpl.Execute(f, genCtx); err != nil {
```

Also update `prepareDefaultDockerCompose` to use `buildGeneratorContext`:

```go
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
```

**Step 6: Run all deployment tests**

Run: `cd temporal-workflows && go test -v -race -run "TestValidateDeployment|TestPrepareGenerator|TestBuildGenerator" ./internal/activities/`
Expected: All PASS

**Step 7: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go
git add temporal-workflows/internal/activities/deployment_activities_envvars_test.go
git commit -m "feat(deployment): add GeneratorContext with env var injection support"
```

---

## Task 4: Add Helm Generator Support to ExecuteGenerator

The `ExecuteGenerator` activity currently returns an error for `helm` type. Add generate-mode support (read rendered files, return them).

**Files:**
- Modify: `temporal-workflows/internal/activities/deployment_activities.go`

**Step 1: Write the test**

Add to the existing test file `temporal-workflows/internal/activities/deployment_activities_test.go`:

```go
func TestExecuteGenerator_Helm_GenerateMode(t *testing.T) {
	workDir := t.TempDir()

	// Write some rendered Helm files
	require.NoError(t, os.MkdirAll(filepath.Join(workDir, "templates"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "Chart.yaml"), []byte("apiVersion: v2\nname: test\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "values.yaml"), []byte("replicaCount: 1\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "templates/deployment.yaml"), []byte("kind: Deployment\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "templates/service.yaml"), []byte("kind: Service\n"), 0644))

	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())
	input := ExecuteGeneratorInput{
		DeploymentID:  "test-123",
		GeneratorType: "helm",
		WorkDir:       workDir,
		Mode:          "generate",
	}

	result, err := activities.ExecuteGenerator(context.Background(), input)
	require.NoError(t, err)
	require.True(t, result.Success)
	require.GreaterOrEqual(t, len(result.GeneratedFiles), 4)

	// Verify file paths are relative
	for _, f := range result.GeneratedFiles {
		require.NotContains(t, f.Path, workDir, "paths should be relative")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -race -run TestExecuteGenerator_Helm_GenerateMode ./internal/activities/`
Expected: FAIL (helm not implemented error)

**Step 3: Implement helm and generic generate-mode handler**

Replace the `ExecuteGenerator` method in `deployment_activities.go`:

```go
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

// collectGeneratedFiles walks the work directory and returns all files
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
```

Also update `executeDockerCompose` to use `collectGeneratedFiles` for its generate mode instead of duplicating the file-reading logic:

Replace the generate-mode block in `executeDockerCompose`:
```go
// Generate mode: return the files without executing
if input.Mode == "generate" {
    return a.collectGeneratedFiles(input.WorkDir)
}
```

**Step 4: Run tests**

Run: `cd temporal-workflows && go test -v -race -run "TestExecuteGenerator" ./internal/activities/`
Expected: All PASS

**Step 5: Update Helm validation**

Replace the empty `validateHelmConfig` in `deployment_activities.go`:

```go
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
```

**Step 6: Add Helm validation test**

Add to `deployment_activities_test.go`:

```go
func TestValidateDeploymentConfig_Helm_Valid(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())
	config := map[string]interface{}{"releaseName": "my-release"}
	configBytes, _ := json.Marshal(config)

	err := activities.ValidateDeploymentConfig(context.Background(), ValidateDeploymentConfigInput{
		GeneratorType: "helm",
		Config:        configBytes,
	})
	require.NoError(t, err)
}

func TestValidateDeploymentConfig_Helm_MissingRequired(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())
	config := map[string]interface{}{"namespace": "prod"}
	configBytes, _ := json.Marshal(config)

	err := activities.ValidateDeploymentConfig(context.Background(), ValidateDeploymentConfigInput{
		GeneratorType: "helm",
		Config:        configBytes,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "releaseName")
}
```

**Step 7: Run all tests**

Run: `cd temporal-workflows && go test -v -race -run "TestValidateDeployment|TestExecuteGenerator|TestBuildGenerator|TestPrepareGenerator" ./internal/activities/`
Expected: All PASS

**Step 8: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go
git add temporal-workflows/internal/activities/deployment_activities_test.go
git commit -m "feat(deployment): add Helm generate-mode support and validation"
```

---

## Task 5: Wire CommitToRepo Go Activity with GitHub Trees API

Replace the placeholder `CommitToRepo` activity with a real GitHub implementation.

**Files:**
- Modify: `temporal-workflows/internal/activities/deployment_activities.go`
- Modify: `temporal-workflows/cmd/worker/main.go` (wire up token service)

**Step 1: Add GitHub commit interface to PayloadDeploymentClient**

Extend the `PayloadDeploymentClient` interface in `deployment_activities.go`:

```go
type PayloadDeploymentClient interface {
	GetGeneratorBySlug(ctx context.Context, slug string) (*GeneratorData, error)
	UpdateDeploymentStatus(ctx context.Context, deploymentID, status, url, errorMsg string, generatedFiles []GeneratedFile) error
	GetAppRepository(ctx context.Context, appID string) (*AppRepositoryInfo, error)
	GetAppEnvVarKeys(ctx context.Context, appID string) ([]string, error)
}

// AppRepositoryInfo contains repository details needed for git commits
type AppRepositoryInfo struct {
	Owner          string `json:"owner"`
	Name           string `json:"name"`
	InstallationID string `json:"installationId"`
	DefaultBranch  string `json:"defaultBranch"`
}
```

**Step 2: Add GitHubCommitter interface**

Add a new interface for GitHub operations so CommitToRepo doesn't depend on token service directly:

```go
// GitHubCommitter abstracts GitHub git operations for committing files
type GitHubCommitter interface {
	CommitFiles(ctx context.Context, owner, repo, branch, commitMessage string, files []GeneratedFile) (string, error)
}
```

**Step 3: Update DeploymentActivities struct**

```go
type DeploymentActivities struct {
	workDir       string
	payloadClient PayloadDeploymentClient
	githubCommit  GitHubCommitter
	logger        *slog.Logger
}

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

// SetGitHubCommitter sets the GitHub committer (called after construction when deps are available)
func (a *DeploymentActivities) SetGitHubCommitter(committer GitHubCommitter) {
	a.githubCommit = committer
}
```

**Step 4: Implement CommitToRepo**

Replace the placeholder implementation:

```go
func (a *DeploymentActivities) CommitToRepo(ctx context.Context, input CommitToRepoInput) (*CommitToRepoResult, error) {
	a.logger.Info("Committing files to repository",
		"deploymentID", input.DeploymentID,
		"appID", input.AppID,
		"fileCount", len(input.Files))

	if a.payloadClient == nil {
		a.logger.Warn("No Payload client, returning placeholder")
		return &CommitToRepoResult{Success: true, CommitSHA: "placeholder-sha"}, nil
	}

	if a.githubCommit == nil {
		a.logger.Warn("No GitHub committer configured, returning placeholder")
		return &CommitToRepoResult{Success: true, CommitSHA: "placeholder-sha"}, nil
	}

	// Get app repository info
	repoInfo, err := a.payloadClient.GetAppRepository(ctx, input.AppID)
	if err != nil {
		return &CommitToRepoResult{
			Success: false,
			Error:   fmt.Sprintf("failed to get app repository: %v", err),
		}, nil
	}

	if repoInfo.Owner == "" || repoInfo.Name == "" {
		return &CommitToRepoResult{
			Success: false,
			Error:   "app has no linked repository",
		}, nil
	}

	branch := repoInfo.DefaultBranch
	if branch == "" {
		branch = "main"
	}

	commitMsg := input.CommitMessage
	if commitMsg == "" {
		commitMsg = "chore: add deployment configuration"
	}

	sha, err := a.githubCommit.CommitFiles(ctx, repoInfo.Owner, repoInfo.Name, branch, commitMsg, input.Files)
	if err != nil {
		return &CommitToRepoResult{
			Success: false,
			Error:   fmt.Sprintf("failed to commit to GitHub: %v", err),
		}, nil
	}

	a.logger.Info("Committed files to repository",
		"owner", repoInfo.Owner,
		"repo", repoInfo.Name,
		"sha", sha)

	return &CommitToRepoResult{
		Success:   true,
		CommitSHA: sha,
	}, nil
}
```

**Step 5: Update PrepareGeneratorContext to fetch env vars**

In the `PrepareGeneratorContext` method, after parsing config, add env var fetching:

```go
// Fetch env var keys for the app
var envVars []EnvVarRef
if a.payloadClient != nil {
    keys, err := a.payloadClient.GetAppEnvVarKeys(ctx, input.AppID)
    if err != nil {
        a.logger.Warn("Failed to fetch env var keys, continuing without them", "error", err)
    } else {
        for _, k := range keys {
            envVars = append(envVars, EnvVarRef{Key: k})
        }
    }
}

genCtx := buildGeneratorContext(config, envVars)
```

**Step 6: Run existing tests (should still pass — nil clients)**

Run: `cd temporal-workflows && go test -v -race ./internal/activities/ ./internal/workflows/`
Expected: Existing tests PASS (nil client path still works)

**Step 7: Commit**

```bash
git add temporal-workflows/internal/activities/deployment_activities.go
git commit -m "feat(deployment): wire CommitToRepo with GitHub and env var injection"
```

---

## Task 6: Wire commitGeneratedFiles and getRepoBranches Server Actions

Replace the stub TypeScript server actions with real implementations.

**Files:**
- Modify: `orbit-www/src/app/actions/deployments.ts`

**Step 1: Implement getRepoBranches**

Replace the stub `getRepoBranches` function in `orbit-www/src/app/actions/deployments.ts`:

```typescript
export async function getRepoBranches(appId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', branches: [] as string[] }
  }

  const payload = await getPayload({ config })

  try {
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 0,
      overrideAccess: true,
    })

    if (!app?.repository?.installationId || !app.repository.owner || !app.repository.name) {
      return { success: true, branches: ['main'], defaultBranch: 'main' }
    }

    const { createInstallationToken } = await import('@/lib/github/octokit')
    const { token } = await createInstallationToken(Number(app.repository.installationId))

    const response = await fetch(
      `https://api.github.com/repos/${app.repository.owner}/${app.repository.name}/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )

    if (!response.ok) {
      console.error('GitHub branches API error:', response.status)
      return { success: true, branches: ['main'], defaultBranch: 'main' }
    }

    const data = await response.json() as Array<{ name: string }>
    const branches = data.map(b => b.name)

    // Get default branch
    const repoResponse = await fetch(
      `https://api.github.com/repos/${app.repository.owner}/${app.repository.name}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )

    let defaultBranch = 'main'
    if (repoResponse.ok) {
      const repoData = await repoResponse.json() as { default_branch: string }
      defaultBranch = repoData.default_branch
    }

    return { success: true, branches, defaultBranch }
  } catch (error) {
    console.error('Failed to fetch branches:', error)
    return { success: true, branches: ['main'], defaultBranch: 'main' }
  }
}
```

**Step 2: Implement commitGeneratedFiles**

Replace the stub `commitGeneratedFiles` function. This uses the GitHub Trees API directly from the server action (since the Temporal workflow has already finished at this point — the user is reviewing generated files):

```typescript
export async function commitGeneratedFiles(input: {
  deploymentId: string
  branch: string
  newBranch?: string
  message: string
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    const deployment = await payload.findByID({
      collection: 'deployments',
      id: input.deploymentId,
      depth: 1,
    })

    if (!deployment) {
      return { success: false, error: 'Deployment not found' }
    }

    const files = (deployment.generatedFiles as Array<{ path: string; content: string }>) || []
    if (files.length === 0) {
      return { success: false, error: 'No generated files to commit' }
    }

    // Get app for repository info
    const appId = typeof deployment.app === 'string' ? deployment.app : deployment.app.id
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 0,
      overrideAccess: true,
    })

    if (!app?.repository?.installationId || !app.repository.owner || !app.repository.name) {
      return { success: false, error: 'App has no linked repository' }
    }

    const { createInstallationToken } = await import('@/lib/github/octokit')
    const { token } = await createInstallationToken(
      Number(app.repository.installationId),
      { includePackages: false }
    )

    const owner = app.repository.owner
    const repo = app.repository.name
    const targetBranch = input.newBranch || input.branch
    const apiBase = `https://api.github.com/repos/${owner}/${repo}`
    const githubHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    }

    // 1. Get the ref for the source branch
    const refResponse = await fetch(`${apiBase}/git/ref/heads/${input.branch}`, {
      headers: githubHeaders,
    })
    if (!refResponse.ok) {
      return { success: false, error: `Branch "${input.branch}" not found` }
    }
    const refData = await refResponse.json() as { object: { sha: string } }
    const baseSha = refData.object.sha

    // 2. If creating a new branch, create the ref
    if (input.newBranch) {
      const createRefResponse = await fetch(`${apiBase}/git/refs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          ref: `refs/heads/${input.newBranch}`,
          sha: baseSha,
        }),
      })
      if (!createRefResponse.ok) {
        const err = await createRefResponse.json()
        return { success: false, error: `Failed to create branch: ${(err as { message?: string }).message || 'unknown'}` }
      }
    }

    // 3. Get the base tree
    const commitResponse = await fetch(`${apiBase}/git/commits/${baseSha}`, {
      headers: githubHeaders,
    })
    const commitData = await commitResponse.json() as { tree: { sha: string } }
    const baseTreeSha = commitData.tree.sha

    // 4. Create blobs for each file
    const tree: Array<{ path: string; mode: string; type: string; sha: string }> = []
    for (const file of files) {
      const blobResponse = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          content: file.content,
          encoding: 'utf-8',
        }),
      })
      const blobData = await blobResponse.json() as { sha: string }
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      })
    }

    // 5. Create tree
    const treeResponse = await fetch(`${apiBase}/git/trees`, {
      method: 'POST',
      headers: githubHeaders,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree,
      }),
    })
    const treeData = await treeResponse.json() as { sha: string }

    // 6. Create commit
    const newCommitResponse = await fetch(`${apiBase}/git/commits`, {
      method: 'POST',
      headers: githubHeaders,
      body: JSON.stringify({
        message: input.message,
        tree: treeData.sha,
        parents: [baseSha],
      }),
    })
    const newCommitData = await newCommitResponse.json() as { sha: string }

    // 7. Update ref
    await fetch(`${apiBase}/git/refs/heads/${targetBranch}`, {
      method: 'PATCH',
      headers: githubHeaders,
      body: JSON.stringify({ sha: newCommitData.sha }),
    })

    // 8. Update deployment status
    await payload.update({
      collection: 'deployments',
      id: input.deploymentId,
      data: {
        status: 'deployed',
        lastDeployedAt: new Date().toISOString(),
      },
    })

    return { success: true, commitSha: newCommitData.sha }
  } catch (error) {
    console.error('Failed to commit files:', error)
    return { success: false, error: 'Failed to commit files to repository' }
  }
}
```

**Step 3: Verify build**

Run: `cd orbit-www && bun run tsc --noEmit 2>&1 | grep -i "deployments\.\|commit"`
Expected: No new type errors from our changes

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat(deployment): wire commitGeneratedFiles and getRepoBranches with GitHub API"
```

---

## Task 7: Fix AddDeploymentModal for Generator-Specific Config

The modal currently shows docker-compose fields regardless of type. Add conditional fields for Helm.

**Files:**
- Modify: `orbit-www/src/components/features/apps/AddDeploymentModal.tsx`

**Step 1: Update the form schema and UI**

Replace the entire `AddDeploymentModal.tsx` with generator-aware fields:

The key changes:
1. Form schema becomes a discriminated union based on generator type
2. Generator select triggers field visibility changes
3. Description text updates per generator
4. Config object adapts to generator type

Update the form schema to use `superRefine` for conditional validation:

```typescript
const baseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  generator: z.enum(['docker-compose', 'helm', 'custom']),
  // Docker Compose fields
  serviceName: z.string().optional(),
  port: z.number().min(1).max(65535).optional(),
  // Helm fields
  releaseName: z.string().optional(),
  namespace: z.string().optional(),
  replicas: z.number().min(1).max(100).optional(),
})

const formSchema = baseSchema.superRefine((data, ctx) => {
  if (data.generator === 'docker-compose') {
    if (!data.serviceName || data.serviceName.trim() === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Service name is required', path: ['serviceName'] })
    }
  }
  if (data.generator === 'helm') {
    if (!data.releaseName || data.releaseName.trim() === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Release name is required', path: ['releaseName'] })
    }
  }
})
```

Update `defaultValues`:
```typescript
defaultValues: {
  name: 'production',
  generator: 'docker-compose',
  serviceName: appName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  port: 3000,
  releaseName: appName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  namespace: 'default',
  replicas: 1,
},
```

Watch the generator field to conditionally render:
```typescript
const selectedGenerator = form.watch('generator')
```

Replace the hardcoded description div with:
```tsx
<div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
  {selectedGenerator === 'docker-compose' && (
    <>This will generate a <code className="font-mono text-xs">docker-compose.yml</code> file that you can review and commit to your repository.</>
  )}
  {selectedGenerator === 'helm' && (
    <>This will generate a Helm chart (<code className="font-mono text-xs">Chart.yaml</code>, <code className="font-mono text-xs">values.yaml</code>, and templates) that you can review and commit.</>
  )}
  {selectedGenerator !== 'docker-compose' && selectedGenerator !== 'helm' && (
    <>Select a deployment method to generate configuration files.</>
  )}
</div>
```

Show docker-compose fields when `selectedGenerator === 'docker-compose'`:
```tsx
{selectedGenerator === 'docker-compose' && (
  <div className="grid grid-cols-2 gap-4">
    {/* serviceName + port fields (existing) */}
  </div>
)}
```

Show helm fields when `selectedGenerator === 'helm'`:
```tsx
{selectedGenerator === 'helm' && (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      {/* releaseName + namespace fields */}
    </div>
    <div className="grid grid-cols-2 gap-4">
      {/* replicas + port fields */}
    </div>
  </div>
)}
```

Update `onSubmit` to build correct config per generator:
```typescript
const onSubmit = async (data: FormData) => {
  setIsSubmitting(true)
  try {
    let submitConfig: Record<string, unknown>
    if (data.generator === 'helm') {
      submitConfig = {
        releaseName: data.releaseName,
        namespace: data.namespace || 'default',
        replicas: data.replicas || 1,
        port: data.port || 3000,
      }
    } else {
      submitConfig = {
        serviceName: data.serviceName,
        port: data.port || 3000,
      }
    }

    const result = await createDeployment({
      appId,
      name: data.name,
      generator: data.generator,
      config: submitConfig,
      target: { type: 'repository' },
    })
    // ... rest unchanged
```

Also update the `startDeployment` action in `deployments.ts` to use the generator's slug instead of type:
```typescript
generatorSlug: deployment.generator === 'docker-compose'
  ? 'docker-compose-basic'
  : deployment.generator === 'helm'
    ? 'helm-basic'
    : deployment.generator,
```

Remove `'terraform'` from the generator select options since we're deferring it. The Zod enum becomes:
```typescript
generator: z.enum(['docker-compose', 'helm', 'custom']),
```

**Step 2: Update syncDeploymentStatusFromWorkflow**

In `deployments.ts`, update the sync function to handle Helm as generate-mode too:

```typescript
// If generator is docker-compose or helm, it's generate mode -> status should be 'generated'
if (deployment?.generator === 'docker-compose' || deployment?.generator === 'helm') {
  newStatus = 'generated'
} else {
  newStatus = 'deployed'
}
```

Also update the `mode` determination in `startDeployment`:
```typescript
const mode = (deployment.generator === 'docker-compose' || deployment.generator === 'helm') ? 'generate' : 'execute'
```

**Step 3: Verify build**

Run: `cd orbit-www && bun run tsc --noEmit 2>&1 | grep -i "AddDeployment\|deployments"`
Expected: No new type errors

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/apps/AddDeploymentModal.tsx
git add orbit-www/src/app/actions/deployments.ts
git commit -m "feat(deployment): add generator-specific config fields and Helm mode support"
```

---

## Task 8: Final Verification and PR

**Step 1: Run Go tests**

Run: `cd temporal-workflows && go test -v -race -run "TestDeployment|TestBuildGenerator|TestExecuteGenerator|TestValidateDeployment|TestPrepareGenerator" ./internal/...`
Expected: All PASS

**Step 2: Run TypeScript type check**

Run: `cd orbit-www && bun run tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: Only pre-existing errors (none from our files)

**Step 3: Check for our files in type errors**

Run: `bun run tsc --noEmit 2>&1 | grep -E "deployment|AddDeployment|seed"`
Expected: No matches

**Step 4: Update ROADMAP.md**

Mark 2.3 as complete in `docs/ROADMAP.md`:
- Change `#### 2.3 Deployment Generators` to `#### 2.3 Deployment Generators ✅ COMPLETE`
- Replace the TODO items with completed items
- Add PR link
- Update the Feature Maturity Matrix: `Application Lifecycle` from `🟡 50%` to `🟢 70%`
- Add changelog entry

**Step 5: Commit and create PR**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Phase 2.3 Deployment Generators complete in roadmap"
git push -u origin <branch-name>
gh pr create --title "feat: Deployment Generators Phase 2.3 — templates, Helm, CommitToRepo, UI" --body "..."
```
