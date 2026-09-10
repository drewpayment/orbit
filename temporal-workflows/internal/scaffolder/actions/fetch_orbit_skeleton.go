package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

//go:embed fetch_orbit_skeleton.input.schema.json
var fetchOrbitSkeletonInputSchema []byte

//go:embed fetch_orbit_skeleton.output.schema.json
var fetchOrbitSkeletonOutputSchema []byte

// FetchOrbitSkeleton writes an Orbit-hosted template skeleton bundle
// (In-App Template Authoring Phase 3 — see
// docs/plans/2026-09-10-template-authoring-phase-3-greenfield-content.md)
// into a scoped directory under the run's work directory, so a later
// fs:render/git:push step can operate on it. It mirrors FetchGit's shape,
// but sources its content from services.SkeletonClient (orbit-www's
// internal API) rather than git.
type FetchOrbitSkeleton struct {
	client services.SkeletonClient
}

// NewFetchOrbitSkeleton constructs the fetch:orbit-skeleton action. client
// may be nil for descriptor-only use (see DescriptorActions); Plan,
// PlanPreview and Execute all fail loudly if invoked without one.
// DefaultActions omits this action entirely when deps.SkeletonClient is
// nil, so a nil client should never reach Execute in production.
func NewFetchOrbitSkeleton(client services.SkeletonClient) *FetchOrbitSkeleton {
	return &FetchOrbitSkeleton{client: client}
}

type fetchOrbitSkeletonInput struct {
	SkeletonID string `json:"skeletonId"`
	Path       string `json:"path"`
}

type fetchOrbitSkeletonOutput struct {
	Path  string   `json:"path"`
	Files []string `json:"files"`
}

// Name implements scaffolder.Action.
func (a *FetchOrbitSkeleton) Name() string { return "fetch:orbit-skeleton" }

// InputSchema implements scaffolder.Action.
func (a *FetchOrbitSkeleton) InputSchema() json.RawMessage { return fetchOrbitSkeletonInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *FetchOrbitSkeleton) OutputSchema() json.RawMessage { return fetchOrbitSkeletonOutputSchema }

// Plan fetches the skeleton's manifest (file list only, no content) and
// reports a single summary change. Per-file detail for the dry-run diff
// viewer comes from PlanPreview instead, which the dispatch activity calls
// in preference to Plan whenever an action implements PlanPreviewer.
func (a *FetchOrbitSkeleton) Plan(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseFetchOrbitSkeletonInput(input)
	if err != nil {
		return nil, err
	}
	dest, err := resolveFetchDest(rc.WorkDir, in.Path, in.SkeletonID)
	if err != nil {
		return nil, err
	}
	if a.client == nil {
		return nil, fmt.Errorf("fetch:orbit-skeleton: no skeleton client configured")
	}

	manifest, err := a.client.GetSkeletonManifest(ctx, in.SkeletonID, rc.WorkspaceID)
	if err != nil {
		return nil, mapSkeletonClientErr(err)
	}
	return []scaffolder.PlannedChange{{
		Kind:        "fetch",
		Name:        manifest.Name,
		Description: fmt.Sprintf("fetch skeleton %q (%d files) into %s", manifest.Name, len(manifest.Files), dest),
	}}, nil
}

// PlanPreview implements scaffolder.PlanPreviewer: it fetches the full
// skeleton bundle and writes its unrendered files into destDir, which the
// caller creates and owns, so a later fs:render step's dry-run diff can be
// computed against them.
func (a *FetchOrbitSkeleton) PlanPreview(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage, destDir string) ([]scaffolder.PlannedChange, error) {
	in, err := parseFetchOrbitSkeletonInput(input)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(destDir) == "" {
		return nil, fmt.Errorf("fetch:orbit-skeleton: a preview destination directory is required")
	}
	if a.client == nil {
		return nil, fmt.Errorf("fetch:orbit-skeleton: no skeleton client configured")
	}

	bundle, err := a.client.GetSkeletonBundle(ctx, in.SkeletonID, rc.WorkspaceID)
	if err != nil {
		return nil, mapSkeletonClientErr(err)
	}
	if err := writeSkeletonFiles(destDir, bundle.Files); err != nil {
		return nil, err
	}

	changes := make([]scaffolder.PlannedChange, 0, len(bundle.Files))
	for _, f := range bundle.Files {
		changes = append(changes, scaffolder.PlannedChange{
			Kind:        "file",
			Name:        f.Path,
			Description: fmt.Sprintf("write %s", f.Path),
		})
	}
	return changes, nil
}

// Execute fetches the skeleton bundle and writes its files under the run's
// work directory.
func (a *FetchOrbitSkeleton) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseFetchOrbitSkeletonInput(input)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rc.WorkDir) == "" {
		return nil, fmt.Errorf("fetch:orbit-skeleton: %w: run has no work directory", scaffolder.ErrInvalidInput)
	}
	dest, err := resolveFetchDest(rc.WorkDir, in.Path, in.SkeletonID)
	if err != nil {
		return nil, err
	}
	if a.client == nil {
		return nil, fmt.Errorf("fetch:orbit-skeleton: no skeleton client configured")
	}

	rc.Heartbeat("fetch:orbit-skeleton", in.SkeletonID)
	bundle, err := a.client.GetSkeletonBundle(ctx, in.SkeletonID, rc.WorkspaceID)
	if err != nil {
		return nil, mapSkeletonClientErr(err)
	}
	if err := writeSkeletonFiles(dest, bundle.Files); err != nil {
		return nil, err
	}

	files := make([]string, 0, len(bundle.Files))
	for _, f := range bundle.Files {
		files = append(files, f.Path)
	}
	return json.Marshal(fetchOrbitSkeletonOutput{Path: dest, Files: files})
}

// mapSkeletonClientErr maps ErrSkeletonNotFound onto scaffolder.ErrInvalidInput
// so the dispatch activity treats an unknown or cross-workspace skeleton id
// as a non-retryable definition problem rather than a transient one. Any
// other client error (network, 5xx) passes through unwrapped so ordinary
// retry behavior still applies.
func mapSkeletonClientErr(err error) error {
	if errors.Is(err, services.ErrSkeletonNotFound) {
		return fmt.Errorf("fetch:orbit-skeleton: %w: skeleton not found: %v", scaffolder.ErrInvalidInput, err)
	}
	return fmt.Errorf("fetch:orbit-skeleton: %w", err)
}

// writeSkeletonFiles writes each file relative to destDir. It validates
// every file's path BEFORE writing any of them, so a bundle with one
// malicious entry among otherwise-fine files leaves nothing behind — the
// manifest arrives through orbit-www's internal API, but a compromised or
// buggy skeleton document is still untrusted relative to the worker's
// filesystem, same trust boundary as a template author's `${{ }}`
// expression.
func writeSkeletonFiles(destDir string, files []services.SkeletonFile) error {
	targets := make([]string, len(files))
	for i, f := range files {
		target, err := resolveSkeletonFilePath(destDir, f.Path)
		if err != nil {
			return err
		}
		targets[i] = target
	}
	for i, f := range files {
		target := targets[i]
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("fetch:orbit-skeleton: create directory for %q: %w", f.Path, err)
		}
		if err := os.WriteFile(target, []byte(f.Content), 0o644); err != nil {
			return fmt.Errorf("fetch:orbit-skeleton: write %q: %w", f.Path, err)
		}
	}
	return nil
}

// resolveSkeletonFilePath validates and resolves one bundle file's path
// against destDir. It rejects an empty path, an absolute path, a backslash
// (a Windows separator smuggled into what must be a POSIX-relative path),
// or any ".." segment that would resolve outside destDir.
func resolveSkeletonFilePath(destDir, relPath string) (string, error) {
	if strings.TrimSpace(relPath) == "" {
		return "", fmt.Errorf("fetch:orbit-skeleton: %w: bundle file has an empty path", scaffolder.ErrInvalidInput)
	}
	if filepath.IsAbs(relPath) || strings.HasPrefix(relPath, "/") {
		return "", fmt.Errorf("fetch:orbit-skeleton: %w: bundle file path %q must be relative", scaffolder.ErrInvalidInput, relPath)
	}
	if strings.Contains(relPath, "\\") {
		return "", fmt.Errorf("fetch:orbit-skeleton: %w: bundle file path %q must not contain backslashes", scaffolder.ErrInvalidInput, relPath)
	}

	absDest, err := filepath.Abs(destDir)
	if err != nil {
		return "", fmt.Errorf("fetch:orbit-skeleton: resolve destination: %w", err)
	}
	target := filepath.Join(absDest, relPath)
	rel, err := filepath.Rel(absDest, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("fetch:orbit-skeleton: %w: bundle file path %q escapes the destination directory", scaffolder.ErrInvalidInput, relPath)
	}
	return target, nil
}

func parseFetchOrbitSkeletonInput(raw json.RawMessage) (fetchOrbitSkeletonInput, error) {
	var in fetchOrbitSkeletonInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("fetch:orbit-skeleton: %w: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	if strings.TrimSpace(in.SkeletonID) == "" {
		return in, fmt.Errorf("fetch:orbit-skeleton: %w: `skeletonId` is required", scaffolder.ErrInvalidInput)
	}
	return in, nil
}
