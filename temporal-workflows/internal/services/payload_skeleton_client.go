package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

// SkeletonFile is one file in an Orbit-hosted template skeleton bundle.
// Content is empty when fetched via GetSkeletonManifest (the route's
// ?manifest=1 mode) and populated via GetSkeletonBundle.
type SkeletonFile struct {
	Path    string `json:"path"`
	Size    int    `json:"size"`
	Content string `json:"content,omitempty"`
}

// SkeletonBundle is the GET
// /api/internal/template-skeletons/{id}?workspaceId=... response, in
// either its manifest (`?manifest=1`, no file content) or full form. Both
// share this shape — GetSkeletonManifest just calls the route with
// manifest=1 and leaves each file's Content empty.
type SkeletonBundle struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Slug      string         `json:"slug"`
	Version   int            `json:"version"`
	TotalSize int            `json:"totalSize"`
	Files     []SkeletonFile `json:"files"`
}

// ErrSkeletonNotFound is returned when a template-skeletons id doesn't
// resolve, or resolves but does not belong to the given workspace. The
// route deliberately returns 404 for both cases, never 403, so the
// internal API key alone can never be used to confirm another workspace's
// skeleton even exists (see the route's doc comment).
var ErrSkeletonNotFound = errors.New("template skeleton not found")

// SkeletonClient fetches an Orbit-hosted template skeleton bundle
// (In-App Template Authoring Phase 3) for the fetch:orbit-skeleton
// scaffolder action.
type SkeletonClient interface {
	// GetSkeletonManifest returns the file list without content, for the
	// action's Plan (dry-run) path.
	GetSkeletonManifest(ctx context.Context, skeletonID, workspaceID string) (*SkeletonBundle, error)
	// GetSkeletonBundle returns the full bundle including file content, for
	// the action's Execute path.
	GetSkeletonBundle(ctx context.Context, skeletonID, workspaceID string) (*SkeletonBundle, error)
}

// PayloadSkeletonClient calls orbit-www's internal API to fetch a template
// skeleton bundle. See the doc comment at the top of
// orbit-www/src/app/api/internal/template-skeletons/[id]/route.ts for the
// full contract this implements.
type PayloadSkeletonClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadSkeletonClient constructs the client.
func NewPayloadSkeletonClient(baseURL, apiKey string, logger *slog.Logger) *PayloadSkeletonClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadSkeletonClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// GetSkeletonManifest calls
// GET {baseURL}/api/internal/template-skeletons/{id}?workspaceId=...&manifest=1.
func (c *PayloadSkeletonClient) GetSkeletonManifest(ctx context.Context, skeletonID, workspaceID string) (*SkeletonBundle, error) {
	return c.get(ctx, skeletonID, workspaceID, true)
}

// GetSkeletonBundle calls
// GET {baseURL}/api/internal/template-skeletons/{id}?workspaceId=....
func (c *PayloadSkeletonClient) GetSkeletonBundle(ctx context.Context, skeletonID, workspaceID string) (*SkeletonBundle, error) {
	return c.get(ctx, skeletonID, workspaceID, false)
}

func (c *PayloadSkeletonClient) get(ctx context.Context, skeletonID, workspaceID string, manifestOnly bool) (*SkeletonBundle, error) {
	if skeletonID == "" {
		return nil, errors.New("skeleton id required")
	}
	if workspaceID == "" {
		return nil, errors.New("workspace id required")
	}

	q := url.Values{}
	q.Set("workspaceId", workspaceID)
	if manifestOnly {
		q.Set("manifest", "1")
	}
	u := c.baseURL + "/api/internal/template-skeletons/" + url.PathEscape(skeletonID) + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	// A skeleton bundle is capped at 1MB of file content (enforced by
	// validate-skeleton-bundle.ts); 8MiB leaves headroom for the JSON
	// envelope and per-file metadata without accepting an unbounded body.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrSkeletonNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("get template skeleton: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var out SkeletonBundle
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("get template skeleton: decode response: %w", err)
	}
	return &out, nil
}
