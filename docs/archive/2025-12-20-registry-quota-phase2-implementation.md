# Registry Quota Management - Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement automatic quota management that cleans up old images before builds exceed workspace limits.

**Architecture:** Build-service handles all registry operations (quota check, cleanup, image tracking). Temporal workflow calls build-service RPCs before/after builds. Payload stores image metadata and provides internal API. Dashboard shows quota warnings.

**Tech Stack:** Go (build-service), Protocol Buffers, Temporal, Payload CMS (Next.js), Docker Registry v2 API

---

## Task 1: Add Protobuf Messages for Quota Management

**Files:**
- Modify: `proto/idp/build/v1/build.proto`

**Step 1: Add quota management messages**

Add after existing messages (around line 130):

```protobuf
// Quota management messages
message CheckQuotaRequest {
  string workspace_id = 1;
  int64 incoming_image_size_estimate = 2; // Optional hint for pre-check
}

message CheckQuotaResponse {
  bool cleanup_performed = 1;
  int64 current_usage_bytes = 2;
  int64 quota_bytes = 3;
  repeated CleanedImage cleaned_images = 4;
  string error = 5;
}

message CleanedImage {
  string app_name = 1;
  string tag = 2;
  int64 size_bytes = 3;
}

message TrackImageRequest {
  string workspace_id = 1;
  string app_id = 2;
  string tag = 3;
  string digest = 4;
  string registry_url = 5;
  string repository = 6;
}

message TrackImageResponse {
  int64 size_bytes = 1;
  int64 new_total_usage = 2;
  string error = 3;
}
```

**Step 2: Add RPC methods to BuildService**

Find the `service BuildService` block and add:

```protobuf
  // Quota management
  rpc CheckQuotaAndCleanup(CheckQuotaRequest) returns (CheckQuotaResponse);
  rpc TrackImage(TrackImageRequest) returns (TrackImageResponse);
```

**Step 3: Regenerate proto code**

Run: `make proto-gen`
Expected: Successful generation

**Step 4: Verify generated Go code**

Run: `grep -l "CheckQuotaAndCleanup" proto/gen/go/idp/build/v1/*.go`
Expected: Shows `build_grpc.pb.go`

**Step 5: Commit**

```bash
git add proto/
git commit -m "feat: add quota management protobuf messages"
```

---

## Task 2: Create Registry Client for Docker Registry API

**Files:**
- Create: `services/build-service/internal/registry/client.go`
- Create: `services/build-service/internal/registry/client_test.go`

**Step 1: Create registry client interface and struct**

Create `services/build-service/internal/registry/client.go`:

```go
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
)

// Client interfaces with Docker Registry v2 API
type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewClient creates a new registry client
func NewClient(baseURL string, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	// Ensure URL doesn't have trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{},
		logger:     logger,
	}
}

// ManifestInfo contains image manifest details
type ManifestInfo struct {
	Digest    string
	MediaType string
	Size      int64
}

// GetManifest retrieves manifest info for an image tag
func (c *Client) GetManifest(ctx context.Context, repository, tag string) (*ManifestInfo, error) {
	url := fmt.Sprintf("%s/v2/%s/manifests/%s", c.baseURL, repository, tag)

	req, err := http.NewRequestWithContext(ctx, "HEAD", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Accept manifest types
	req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("manifest not found: %s:%s", repository, tag)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	digest := resp.Header.Get("Docker-Content-Digest")
	contentLength := resp.ContentLength
	mediaType := resp.Header.Get("Content-Type")

	return &ManifestInfo{
		Digest:    digest,
		MediaType: mediaType,
		Size:      contentLength,
	}, nil
}

// ImageSize calculates total image size by summing layers
func (c *Client) ImageSize(ctx context.Context, repository, tag string) (int64, error) {
	url := fmt.Sprintf("%s/v2/%s/manifests/%s", c.baseURL, repository, tag)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, fmt.Errorf("failed to read response: %w", err)
	}

	var manifest struct {
		Config struct {
			Size int64 `json:"size"`
		} `json:"config"`
		Layers []struct {
			Size int64 `json:"size"`
		} `json:"layers"`
	}

	if err := json.Unmarshal(body, &manifest); err != nil {
		return 0, fmt.Errorf("failed to parse manifest: %w", err)
	}

	var total int64 = manifest.Config.Size
	for _, layer := range manifest.Layers {
		total += layer.Size
	}

	return total, nil
}

// DeleteManifest deletes an image by digest
func (c *Client) DeleteManifest(ctx context.Context, repository, digest string) error {
	url := fmt.Sprintf("%s/v2/%s/manifests/%s", c.baseURL, repository, digest)

	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to delete manifest, status: %d", resp.StatusCode)
	}

	c.logger.Info("Deleted manifest", "repository", repository, "digest", digest)
	return nil
}
```

**Step 2: Verify build**

Run: `cd services/build-service && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add services/build-service/internal/registry/
git commit -m "feat: add Docker Registry v2 API client"
```

---

## Task 3: Create Payload Client for Registry Operations

**Files:**
- Create: `services/build-service/internal/payload/registry.go`

**Step 1: Create Payload registry client**

Create `services/build-service/internal/payload/registry.go`:

```go
package payload

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// RegistryClient handles Payload CMS registry operations
type RegistryClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewRegistryClient creates a new Payload registry client
func NewRegistryClient(baseURL, apiKey string, logger *slog.Logger) *RegistryClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &RegistryClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
	}
}

// RegistryUsage represents workspace registry usage
type RegistryUsage struct {
	CurrentBytes int64 `json:"currentBytes"`
	QuotaBytes   int64 `json:"quotaBytes"`
}

// RegistryImage represents an image record from Payload
type RegistryImage struct {
	ID          string    `json:"id"`
	Workspace   string    `json:"workspace"`
	App         string    `json:"app"`
	AppName     string    `json:"appName"`
	Tag         string    `json:"tag"`
	Digest      string    `json:"digest"`
	SizeBytes   int64     `json:"sizeBytes"`
	PushedAt    time.Time `json:"pushedAt"`
}

// GetRegistryUsage fetches current registry usage for a workspace
func (c *RegistryClient) GetRegistryUsage(ctx context.Context, workspaceID string) (*RegistryUsage, error) {
	url := fmt.Sprintf("%s/api/internal/workspaces/%s/registry-usage", c.baseURL, workspaceID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch registry usage: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var usage RegistryUsage
	if err := json.NewDecoder(resp.Body).Decode(&usage); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &usage, nil
}

// GetRegistryImages fetches all registry images for a workspace
func (c *RegistryClient) GetRegistryImages(ctx context.Context, workspaceID string) ([]RegistryImage, error) {
	url := fmt.Sprintf("%s/api/internal/workspaces/%s/registry-images", c.baseURL, workspaceID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch registry images: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var images []RegistryImage
	if err := json.NewDecoder(resp.Body).Decode(&images); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return images, nil
}

// CreateRegistryImage creates or updates a registry image record
func (c *RegistryClient) CreateRegistryImage(ctx context.Context, image RegistryImage) error {
	url := fmt.Sprintf("%s/api/internal/registry-images", c.baseURL)

	body, err := json.Marshal(image)
	if err != nil {
		return fmt.Errorf("failed to marshal image: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to create registry image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// DeleteRegistryImage deletes a registry image record
func (c *RegistryClient) DeleteRegistryImage(ctx context.Context, imageID string) error {
	url := fmt.Sprintf("%s/api/internal/registry-images/%s", c.baseURL, imageID)

	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete registry image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
```

**Step 2: Verify build**

Run: `cd services/build-service && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add services/build-service/internal/payload/
git commit -m "feat: add Payload client for registry operations"
```

---

## Task 4: Implement Cleanup Algorithm

**Files:**
- Create: `services/build-service/internal/registry/cleaner.go`

**Step 1: Create cleaner implementation**

Create `services/build-service/internal/registry/cleaner.go`:

```go
package registry

import (
	"context"
	"log/slog"
	"sort"

	"github.com/drewpayment/orbit/services/build-service/internal/payload"
)

// Cleaner handles registry quota cleanup
type Cleaner struct {
	registryClient *Client
	payloadClient  *payload.RegistryClient
	logger         *slog.Logger
}

// CleanupResult contains the result of a cleanup operation
type CleanupResult struct {
	CleanupPerformed bool
	CurrentUsage     int64
	QuotaBytes       int64
	CleanedImages    []CleanedImage
	Error            string
}

// CleanedImage represents an image that was cleaned up
type CleanedImage struct {
	AppName   string
	Tag       string
	SizeBytes int64
}

// NewCleaner creates a new registry cleaner
func NewCleaner(registryClient *Client, payloadClient *payload.RegistryClient, logger *slog.Logger) *Cleaner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Cleaner{
		registryClient: registryClient,
		payloadClient:  payloadClient,
		logger:         logger,
	}
}

// CleanupIfNeeded checks quota and cleans up if necessary
func (c *Cleaner) CleanupIfNeeded(ctx context.Context, workspaceID string) (*CleanupResult, error) {
	// Get current usage
	usage, err := c.payloadClient.GetRegistryUsage(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	c.logger.Info("Checking registry quota",
		"workspaceID", workspaceID,
		"currentBytes", usage.CurrentBytes,
		"quotaBytes", usage.QuotaBytes,
		"percentUsed", float64(usage.CurrentBytes)/float64(usage.QuotaBytes)*100)

	// Check if cleanup needed (> 80% threshold)
	triggerThreshold := usage.QuotaBytes * 80 / 100
	if usage.CurrentBytes < triggerThreshold {
		return &CleanupResult{
			CleanupPerformed: false,
			CurrentUsage:     usage.CurrentBytes,
			QuotaBytes:       usage.QuotaBytes,
		}, nil
	}

	c.logger.Info("Quota exceeded threshold, starting cleanup",
		"threshold", triggerThreshold,
		"current", usage.CurrentBytes)

	// Get all images for workspace
	images, err := c.payloadClient.GetRegistryImages(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	// Run cleanup algorithm
	cleaned, newUsage := c.runCleanup(ctx, images, usage.CurrentBytes, usage.QuotaBytes)

	return &CleanupResult{
		CleanupPerformed: len(cleaned) > 0,
		CurrentUsage:     newUsage,
		QuotaBytes:       usage.QuotaBytes,
		CleanedImages:    cleaned,
	}, nil
}

// runCleanup executes the cleanup algorithm
func (c *Cleaner) runCleanup(ctx context.Context, images []payload.RegistryImage, currentBytes, quotaBytes int64) ([]CleanedImage, int64) {
	targetBytes := quotaBytes * 70 / 100 // Target 70%

	// Group images by app
	appImages := make(map[string][]payload.RegistryImage)
	for _, img := range images {
		appImages[img.App] = append(appImages[img.App], img)
	}

	// Sort each app's images by pushedAt (newest first)
	for app := range appImages {
		sort.Slice(appImages[app], func(i, j int) bool {
			return appImages[app][i].PushedAt.After(appImages[app][j].PushedAt)
		})
	}

	// Identify candidates (keep 3 most recent per app)
	var candidates []payload.RegistryImage
	for _, imgs := range appImages {
		if len(imgs) > 3 {
			candidates = append(candidates, imgs[3:]...)
		}
	}

	// Sort candidates by pushedAt (oldest first for deletion)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].PushedAt.Before(candidates[j].PushedAt)
	})

	// Delete until under target
	var cleaned []CleanedImage
	for _, img := range candidates {
		if currentBytes <= targetBytes {
			break
		}

		// Check protection rules
		if c.isProtected(img, appImages[img.App]) {
			continue
		}

		// Delete from registry
		if err := c.registryClient.DeleteManifest(ctx, img.AppName+"/"+img.Tag, img.Digest); err != nil {
			c.logger.Warn("Failed to delete from registry", "error", err, "image", img.Tag)
			continue
		}

		// Delete from Payload
		if err := c.payloadClient.DeleteRegistryImage(ctx, img.ID); err != nil {
			c.logger.Warn("Failed to delete from Payload", "error", err, "image", img.Tag)
			continue
		}

		currentBytes -= img.SizeBytes
		cleaned = append(cleaned, CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		})

		c.logger.Info("Deleted image", "app", img.AppName, "tag", img.Tag, "size", img.SizeBytes)
	}

	// If still over target, run more aggressive cleanup (keep 2 per app)
	if currentBytes > targetBytes {
		cleaned2, currentBytes := c.aggressiveCleanup(ctx, appImages, currentBytes, targetBytes)
		cleaned = append(cleaned, cleaned2...)
		return cleaned, currentBytes
	}

	return cleaned, currentBytes
}

// aggressiveCleanup reduces to 2 tags per app
func (c *Cleaner) aggressiveCleanup(ctx context.Context, appImages map[string][]payload.RegistryImage, currentBytes, targetBytes int64) ([]CleanedImage, int64) {
	var candidates []payload.RegistryImage
	for _, imgs := range appImages {
		if len(imgs) > 2 {
			candidates = append(candidates, imgs[2:]...)
		}
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].PushedAt.Before(candidates[j].PushedAt)
	})

	var cleaned []CleanedImage
	for _, img := range candidates {
		if currentBytes <= targetBytes {
			break
		}

		if c.isProtected(img, appImages[img.App]) {
			continue
		}

		if err := c.registryClient.DeleteManifest(ctx, img.AppName+"/"+img.Tag, img.Digest); err != nil {
			continue
		}
		if err := c.payloadClient.DeleteRegistryImage(ctx, img.ID); err != nil {
			continue
		}

		currentBytes -= img.SizeBytes
		cleaned = append(cleaned, CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		})
	}

	return cleaned, currentBytes
}

// isProtected checks if an image should not be deleted
func (c *Cleaner) isProtected(img payload.RegistryImage, appImages []payload.RegistryImage) bool {
	// Never delete the only image for an app
	if len(appImages) <= 1 {
		return true
	}

	// Never delete "latest" if it's the only remaining tag
	if img.Tag == "latest" && len(appImages) <= 2 {
		return true
	}

	return false
}
```

**Step 2: Verify build**

Run: `cd services/build-service && go build ./...`
Expected: No errors

**Step 3: Commit**

```bash
git add services/build-service/internal/registry/
git commit -m "feat: implement registry cleanup algorithm"
```

---

## Task 5: Add Quota RPCs to Build Service

**Files:**
- Modify: `services/build-service/internal/grpc/build/server.go`

**Step 1: Add dependencies to BuildServer struct**

Find the `BuildServer` struct and add fields:

```go
type BuildServer struct {
	buildv1.UnimplementedBuildServiceServer
	logger          *slog.Logger
	workDir         string
	analyzer        *railpack.Analyzer
	builder         *builder.Builder
	registryClient  *registry.Client      // ADD
	payloadClient   *payload.RegistryClient // ADD
	cleaner         *registry.Cleaner     // ADD
}
```

**Step 2: Add imports**

Add to imports:

```go
	"github.com/drewpayment/orbit/services/build-service/internal/payload"
	"github.com/drewpayment/orbit/services/build-service/internal/registry"
```

**Step 3: Update NewBuildServerWithWorkDir**

```go
func NewBuildServerWithWorkDir(logger *slog.Logger, workDir string) *BuildServer {
	if logger == nil {
		logger = slog.Default()
	}

	// Initialize registry client
	registryURL := os.Getenv("ORBIT_REGISTRY_URL")
	if registryURL == "" {
		registryURL = "http://orbit-registry:5000"
	}
	registryClient := registry.NewClient("http://"+registryURL, logger)

	// Initialize Payload client
	payloadURL := os.Getenv("ORBIT_API_URL")
	if payloadURL == "" {
		payloadURL = "http://orbit-www:3000"
	}
	payloadAPIKey := os.Getenv("ORBIT_INTERNAL_API_KEY")
	payloadClient := payload.NewRegistryClient(payloadURL, payloadAPIKey, logger)

	// Initialize cleaner
	cleaner := registry.NewCleaner(registryClient, payloadClient, logger)

	return &BuildServer{
		logger:          logger,
		workDir:         workDir,
		analyzer:        railpack.NewAnalyzer(logger),
		builder:         builder.NewBuilder(logger, workDir),
		registryClient:  registryClient,
		payloadClient:   payloadClient,
		cleaner:         cleaner,
	}
}
```

**Step 4: Implement CheckQuotaAndCleanup RPC**

Add method:

```go
// CheckQuotaAndCleanup checks workspace quota and cleans up if needed
func (s *BuildServer) CheckQuotaAndCleanup(ctx context.Context, req *buildv1.CheckQuotaRequest) (*buildv1.CheckQuotaResponse, error) {
	s.logger.Info("CheckQuotaAndCleanup called", "workspaceID", req.WorkspaceId)

	if req.WorkspaceId == "" {
		return &buildv1.CheckQuotaResponse{
			Error: "workspace_id is required",
		}, nil
	}

	result, err := s.cleaner.CleanupIfNeeded(ctx, req.WorkspaceId)
	if err != nil {
		s.logger.Error("Cleanup failed", "error", err)
		return &buildv1.CheckQuotaResponse{
			Error: fmt.Sprintf("cleanup failed: %v", err),
		}, nil
	}

	// Convert cleaned images to proto
	cleanedImages := make([]*buildv1.CleanedImage, len(result.CleanedImages))
	for i, img := range result.CleanedImages {
		cleanedImages[i] = &buildv1.CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		}
	}

	return &buildv1.CheckQuotaResponse{
		CleanupPerformed:  result.CleanupPerformed,
		CurrentUsageBytes: result.CurrentUsage,
		QuotaBytes:        result.QuotaBytes,
		CleanedImages:     cleanedImages,
	}, nil
}
```

**Step 5: Implement TrackImage RPC**

Add method:

```go
// TrackImage records a pushed image in the registry tracking system
func (s *BuildServer) TrackImage(ctx context.Context, req *buildv1.TrackImageRequest) (*buildv1.TrackImageResponse, error) {
	s.logger.Info("TrackImage called",
		"workspaceID", req.WorkspaceId,
		"appID", req.AppId,
		"tag", req.Tag)

	if req.WorkspaceId == "" || req.AppId == "" || req.Tag == "" {
		return &buildv1.TrackImageResponse{
			Error: "workspace_id, app_id, and tag are required",
		}, nil
	}

	// Get image size from registry
	repository := req.Repository
	size, err := s.registryClient.ImageSize(ctx, repository, req.Tag)
	if err != nil {
		s.logger.Warn("Failed to get image size, using estimate", "error", err)
		size = 0 // Will be updated on next query
	}

	// Create/update image record in Payload
	image := payload.RegistryImage{
		Workspace: req.WorkspaceId,
		App:       req.AppId,
		Tag:       req.Tag,
		Digest:    req.Digest,
		SizeBytes: size,
	}

	if err := s.payloadClient.CreateRegistryImage(ctx, image); err != nil {
		s.logger.Error("Failed to track image", "error", err)
		return &buildv1.TrackImageResponse{
			Error: fmt.Sprintf("failed to track image: %v", err),
		}, nil
	}

	// Get updated total usage
	usage, err := s.payloadClient.GetRegistryUsage(ctx, req.WorkspaceId)
	if err != nil {
		s.logger.Warn("Failed to get updated usage", "error", err)
	}

	return &buildv1.TrackImageResponse{
		SizeBytes:     size,
		NewTotalUsage: usage.CurrentBytes,
	}, nil
}
```

**Step 6: Verify build**

Run: `cd services/build-service && go build ./...`
Expected: No errors

**Step 7: Commit**

```bash
git add services/build-service/
git commit -m "feat: add quota management RPCs to build service"
```

---

## Task 6: Create Payload Internal API Routes

**Files:**
- Create: `orbit-www/src/app/api/internal/workspaces/[id]/registry-usage/route.ts`
- Create: `orbit-www/src/app/api/internal/workspaces/[id]/registry-images/route.ts`
- Create: `orbit-www/src/app/api/internal/registry-images/route.ts`
- Create: `orbit-www/src/app/api/internal/registry-images/[id]/route.ts`

**Step 1: Create registry-usage endpoint**

Create `orbit-www/src/app/api/internal/workspaces/[id]/registry-usage/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify internal API key
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId } = await params
  const payload = await getPayload({ config })

  // Get workspace for quota
  const workspace = await payload.findByID({
    collection: 'workspaces',
    id: workspaceId,
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  // Sum all image sizes for workspace
  const images = await payload.find({
    collection: 'registry-images',
    where: { workspace: { equals: workspaceId } },
    limit: 1000,
  })

  const currentBytes = images.docs.reduce((sum, img) => sum + (img.sizeBytes || 0), 0)
  const quotaBytes = (workspace.settings as any)?.registryQuotaBytes || 10737418240 // 10GB default

  return NextResponse.json({
    currentBytes,
    quotaBytes,
  })
}
```

**Step 2: Create registry-images list endpoint**

Create `orbit-www/src/app/api/internal/workspaces/[id]/registry-images/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: workspaceId } = await params
  const payload = await getPayload({ config })

  const images = await payload.find({
    collection: 'registry-images',
    where: { workspace: { equals: workspaceId } },
    sort: 'pushedAt',
    limit: 1000,
    depth: 1,
  })

  // Map to include app name
  const result = images.docs.map((img) => ({
    id: img.id,
    workspace: typeof img.workspace === 'string' ? img.workspace : img.workspace.id,
    app: typeof img.app === 'string' ? img.app : img.app.id,
    appName: typeof img.app === 'object' ? img.app.name : '',
    tag: img.tag,
    digest: img.digest,
    sizeBytes: img.sizeBytes,
    pushedAt: img.pushedAt,
  }))

  return NextResponse.json(result)
}
```

**Step 3: Create registry-images create endpoint**

Create `orbit-www/src/app/api/internal/registry-images/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await getPayload({ config })
  const body = await request.json()

  // Check if image already exists (upsert by workspace+app+tag)
  const existing = await payload.find({
    collection: 'registry-images',
    where: {
      and: [
        { workspace: { equals: body.workspace } },
        { app: { equals: body.app } },
        { tag: { equals: body.tag } },
      ],
    },
    limit: 1,
  })

  if (existing.docs.length > 0) {
    // Update existing
    const updated = await payload.update({
      collection: 'registry-images',
      id: existing.docs[0].id,
      data: {
        digest: body.digest,
        sizeBytes: body.sizeBytes,
        pushedAt: new Date().toISOString(),
      },
    })
    return NextResponse.json(updated)
  }

  // Create new
  const image = await payload.create({
    collection: 'registry-images',
    data: {
      workspace: body.workspace,
      app: body.app,
      tag: body.tag,
      digest: body.digest,
      sizeBytes: body.sizeBytes,
      pushedAt: new Date().toISOString(),
    },
  })

  return NextResponse.json(image, { status: 201 })
}
```

**Step 4: Create registry-images delete endpoint**

Create `orbit-www/src/app/api/internal/registry-images/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (apiKey !== process.env.ORBIT_INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'registry-images',
    id,
  })

  return NextResponse.json({ success: true })
}
```

**Step 5: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | grep -i "registry" | head -10`
Expected: No new errors

**Step 6: Commit**

```bash
git add orbit-www/src/app/api/internal/
git commit -m "feat: add internal API routes for registry operations"
```

---

## Task 7: Add Temporal Activities for Quota Management

**Files:**
- Modify: `temporal-workflows/internal/activities/build_activities.go`

**Step 1: Add CheckQuotaAndCleanup activity**

Add input/output types:

```go
// QuotaCheckInput is input for CheckQuotaAndCleanup activity
type QuotaCheckInput struct {
	WorkspaceID string `json:"workspaceId"`
}

// QuotaCheckResult is result from CheckQuotaAndCleanup activity
type QuotaCheckResult struct {
	CleanupPerformed  bool           `json:"cleanupPerformed"`
	CurrentUsageBytes int64          `json:"currentUsageBytes"`
	QuotaBytes        int64          `json:"quotaBytes"`
	CleanedImages     []CleanedImage `json:"cleanedImages"`
	Error             string         `json:"error,omitempty"`
}

// CleanedImage represents an image that was cleaned up
type CleanedImage struct {
	AppName   string `json:"appName"`
	Tag       string `json:"tag"`
	SizeBytes int64  `json:"sizeBytes"`
}

// TrackImageInput is input for TrackImage activity
type TrackImageInput struct {
	WorkspaceID string `json:"workspaceId"`
	AppID       string `json:"appId"`
	Tag         string `json:"tag"`
	Digest      string `json:"digest"`
	RegistryURL string `json:"registryUrl"`
	Repository  string `json:"repository"`
}

// TrackImageResult is result from TrackImage activity
type TrackImageResult struct {
	SizeBytes     int64  `json:"sizeBytes"`
	NewTotalUsage int64  `json:"newTotalUsage"`
	Error         string `json:"error,omitempty"`
}
```

**Step 2: Implement CheckQuotaAndCleanup activity**

```go
// CheckQuotaAndCleanup checks workspace quota and cleans up if needed
func (a *BuildActivities) CheckQuotaAndCleanup(ctx context.Context, input QuotaCheckInput) (*QuotaCheckResult, error) {
	a.logger.Info("Checking quota and cleanup", "workspaceID", input.WorkspaceID)

	if input.WorkspaceID == "" {
		return nil, fmt.Errorf("workspace_id is required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	resp, err := client.CheckQuotaAndCleanup(ctx, &buildv1.CheckQuotaRequest{
		WorkspaceId: input.WorkspaceID,
	})
	if err != nil {
		return nil, fmt.Errorf("quota check failed: %w", err)
	}

	// Convert cleaned images
	cleanedImages := make([]CleanedImage, len(resp.CleanedImages))
	for i, img := range resp.CleanedImages {
		cleanedImages[i] = CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		}
	}

	return &QuotaCheckResult{
		CleanupPerformed:  resp.CleanupPerformed,
		CurrentUsageBytes: resp.CurrentUsageBytes,
		QuotaBytes:        resp.QuotaBytes,
		CleanedImages:     cleanedImages,
		Error:             resp.Error,
	}, nil
}
```

**Step 3: Implement TrackImage activity**

```go
// TrackImage records a pushed image in the registry tracking system
func (a *BuildActivities) TrackImage(ctx context.Context, input TrackImageInput) (*TrackImageResult, error) {
	a.logger.Info("Tracking image",
		"workspaceID", input.WorkspaceID,
		"appID", input.AppID,
		"tag", input.Tag)

	if input.WorkspaceID == "" || input.AppID == "" || input.Tag == "" {
		return nil, fmt.Errorf("workspace_id, app_id, and tag are required")
	}

	// Connect to build service
	conn, err := grpc.DialContext(ctx, a.buildServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to build service: %w", err)
	}
	defer conn.Close()

	client := buildv1.NewBuildServiceClient(conn)

	resp, err := client.TrackImage(ctx, &buildv1.TrackImageRequest{
		WorkspaceId: input.WorkspaceID,
		AppId:       input.AppID,
		Tag:         input.Tag,
		Digest:      input.Digest,
		RegistryUrl: input.RegistryURL,
		Repository:  input.Repository,
	})
	if err != nil {
		return nil, fmt.Errorf("track image failed: %w", err)
	}

	return &TrackImageResult{
		SizeBytes:     resp.SizeBytes,
		NewTotalUsage: resp.NewTotalUsage,
		Error:         resp.Error,
	}, nil
}
```

**Step 4: Verify build**

Run: `cd temporal-workflows && go build ./...`
Expected: No errors

**Step 5: Commit**

```bash
git add temporal-workflows/
git commit -m "feat: add quota management activities to Temporal"
```

---

## Task 8: Update Build Workflow with Quota Integration

**Files:**
- Modify: `temporal-workflows/internal/workflows/build_workflow.go`

**Step 1: Add quota check before build**

Find the build workflow function and add after initial setup, before the build step:

```go
// Pre-build quota check (only for Orbit registry)
if input.RegistryType == "orbit" {
	var quotaResult activities.QuotaCheckResult
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 2 * time.Minute,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
			},
		}),
		a.CheckQuotaAndCleanup,
		activities.QuotaCheckInput{
			WorkspaceID: input.WorkspaceID,
		},
	).Get(ctx, &quotaResult)

	if err != nil {
		logger.Warn("Quota check failed, proceeding with build", "error", err)
	} else if quotaResult.CleanupPerformed {
		// Log cleanup info
		var freedBytes int64
		for _, img := range quotaResult.CleanedImages {
			freedBytes += img.SizeBytes
		}
		logger.Info("Cleaned up old images",
			"imageCount", len(quotaResult.CleanedImages),
			"freedBytes", freedBytes)

		// Update build status with cleanup info
		_ = workflow.ExecuteActivity(ctx, a.UpdateBuildStatus, activities.UpdateBuildStatusInput{
			AppID:  input.AppID,
			Status: "building",
		}).Get(ctx, nil)
	}
}
```

**Step 2: Add image tracking after successful build**

Find where the build succeeds and add:

```go
// Post-push image tracking (only for Orbit registry)
if input.RegistryType == "orbit" && buildResult.Success {
	var trackResult activities.TrackImageResult
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 1 * time.Minute,
		}),
		a.TrackImage,
		activities.TrackImageInput{
			WorkspaceID: input.WorkspaceID,
			AppID:       input.AppID,
			Tag:         input.ImageTag,
			Digest:      buildResult.ImageDigest,
			RegistryURL: input.RegistryURL,
			Repository:  input.RegistryRepository,
		},
	).Get(ctx, &trackResult)

	if err != nil {
		logger.Warn("Failed to track image", "error", err)
	} else {
		logger.Info("Image tracked",
			"sizeBytes", trackResult.SizeBytes,
			"totalUsage", trackResult.NewTotalUsage)
	}
}
```

**Step 3: Verify build**

Run: `cd temporal-workflows && go build ./...`
Expected: No errors

**Step 4: Commit**

```bash
git add temporal-workflows/
git commit -m "feat: integrate quota management into build workflow"
```

---

## Task 9: Create Dashboard Quota Warning Component

**Files:**
- Create: `orbit-www/src/components/features/workspace/RegistryQuotaWarning.tsx`
- Create: `orbit-www/src/app/actions/registry.ts`

**Step 1: Create server action for registry usage**

Create `orbit-www/src/app/actions/registry.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export interface RegistryUsage {
  currentBytes: number
  quotaBytes: number
  percentage: number
}

export async function getRegistryUsage(workspaceId: string): Promise<RegistryUsage | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  // Verify workspace membership
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (members.docs.length === 0) {
    return null
  }

  // Get workspace for quota
  const workspace = await payload.findByID({
    collection: 'workspaces',
    id: workspaceId,
  })

  if (!workspace) {
    return null
  }

  // Sum all image sizes
  const images = await payload.find({
    collection: 'registry-images',
    where: { workspace: { equals: workspaceId } },
    limit: 1000,
  })

  const currentBytes = images.docs.reduce((sum, img) => sum + (img.sizeBytes || 0), 0)
  const quotaBytes = (workspace.settings as any)?.registryQuotaBytes || 10737418240

  return {
    currentBytes,
    quotaBytes,
    percentage: Math.round((currentBytes / quotaBytes) * 100),
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
```

**Step 2: Create quota warning component**

Create `orbit-www/src/components/features/workspace/RegistryQuotaWarning.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { getRegistryUsage, formatBytes, type RegistryUsage } from '@/app/actions/registry'

interface RegistryQuotaWarningProps {
  workspaceId: string
}

export function RegistryQuotaWarning({ workspaceId }: RegistryQuotaWarningProps) {
  const [usage, setUsage] = useState<RegistryUsage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchUsage() {
      try {
        const data = await getRegistryUsage(workspaceId)
        setUsage(data)
      } catch (error) {
        console.error('Failed to fetch registry usage:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchUsage()
  }, [workspaceId])

  // Don't show anything while loading or if usage is below threshold
  if (loading || !usage || usage.percentage < 70) {
    return null
  }

  const isNearLimit = usage.percentage >= 90

  return (
    <Alert variant={isNearLimit ? 'destructive' : 'default'} className="mb-4">
      {isNearLimit ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      <AlertTitle>
        {isNearLimit ? 'Registry Almost Full' : 'Registry Usage Warning'}
      </AlertTitle>
      <AlertDescription>
        Using {formatBytes(usage.currentBytes)} of {formatBytes(usage.quotaBytes)} ({usage.percentage}%).
        {isNearLimit
          ? ' Oldest images will be automatically cleaned up on next build.'
          : ' Consider adding your own registry or cleaning up old images.'}
      </AlertDescription>
    </Alert>
  )
}
```

**Step 3: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | grep -i "quota\|registry" | head -10`
Expected: No new errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/registry.ts orbit-www/src/components/features/workspace/
git commit -m "feat: add registry quota warning component and server action"
```

---

## Task 10: Add Quota Warning to Workspace Dashboard

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`

**Step 1: Import and add RegistryQuotaWarning component**

Add import:

```typescript
import { RegistryQuotaWarning } from '@/components/features/workspace/RegistryQuotaWarning'
```

Add component in the page layout, near the top of the main content area:

```typescript
<RegistryQuotaWarning workspaceId={workspace.id} />
```

**Step 2: Verify TypeScript**

Run: `cd orbit-www && bunx tsc --noEmit 2>&1 | grep -i "workspaces.*page" | head -5`
Expected: No new errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/
git commit -m "feat: add registry quota warning to workspace dashboard"
```

---

## Task 11: Add Build Service Environment Variables

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add ORBIT_API_URL to build-service**

Find build-service environment section and add:

```yaml
      - ORBIT_API_URL=http://orbit-www:3000
      - ORBIT_INTERNAL_API_KEY=${ORBIT_INTERNAL_API_KEY:-orbit-internal-dev-key}
```

**Step 2: Verify syntax**

Run: `docker compose config --quiet && echo "Valid"`
Expected: `Valid`

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Payload API env vars to build-service"
```

---

## Task 12: Integration Testing

**Step 1: Rebuild services**

Run: `docker compose build build-service temporal-worker`
Expected: Successful builds

**Step 2: Start services**

Run: `docker compose up -d`
Expected: All services start

**Step 3: Verify registry API**

Run: `curl -s http://localhost:5050/v2/_catalog`
Expected: `{"repositories":[]}`

**Step 4: Verify internal API**

Run: `curl -s -H "Authorization: Bearer orbit-internal-dev-key" http://localhost:3000/api/internal/workspaces/test/registry-usage`
Expected: 404 or JSON response (depending on workspace existence)

**Step 5: Final commit**

```bash
git add .
git commit -m "chore: Phase 2 registry quota management complete"
```

---

## Summary

After completing all tasks:

1. ✅ Protobuf messages for quota management
2. ✅ Registry client for Docker Registry v2 API
3. ✅ Payload client for registry operations
4. ✅ Cleanup algorithm implementation
5. ✅ Quota RPCs in build service
6. ✅ Internal API routes in Payload
7. ✅ Temporal activities for quota management
8. ✅ Build workflow integration
9. ✅ Dashboard quota warning component
10. ✅ Workspace dashboard integration
11. ✅ Environment variables
12. ✅ Integration testing

**Next Phase:** GHCR PAT Integration (Phase 3)
