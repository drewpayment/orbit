package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/templating"
)

//go:embed fs_render.input.schema.json
var fsRenderInputSchema []byte

//go:embed fs_render.output.schema.json
var fsRenderOutputSchema []byte

// FSRender wraps templating.RenderDir: it substitutes `values` into every
// file's content and name under a directory, in place, honoring an
// orbit-template.yaml `rawFiles` opt-out exactly like the v1
// ApplyTemplateVariables activity (both call the same RenderDir
// implementation).
type FSRender struct{}

// NewFSRender constructs the fs:render action.
func NewFSRender() *FSRender { return &FSRender{} }

type fsRenderInput struct {
	Path   string            `json:"path"`
	Values map[string]string `json:"values"`
}

type fsRenderOutput struct {
	Path         string   `json:"path"`
	SkippedFiles []string `json:"skippedFiles"`
}

// Name implements scaffolder.Action.
func (a *FSRender) Name() string { return "fs:render" }

// InputSchema implements scaffolder.Action.
func (a *FSRender) InputSchema() json.RawMessage { return fsRenderInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *FSRender) OutputSchema() json.RawMessage { return fsRenderOutputSchema }

// Execute renders path in place.
func (a *FSRender) Execute(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseFSRenderInput(input)
	if err != nil {
		return nil, err
	}
	if err := requireWithinWorkDir(rc.WorkDir, in.Path); err != nil {
		return nil, fmt.Errorf("fs:render: %w: %v", scaffolder.ErrInvalidInput, err)
	}
	rc.Heartbeat("fs:render", in.Path)

	rawPatterns := activities.LoadRawFilePatterns(in.Path, rc.Logger)
	res, err := templating.RenderDir(in.Path, in.Values, rawPatterns, rc.Logger)
	if err != nil {
		return nil, fmt.Errorf("fs:render: %w", err)
	}

	skipped := res.SkippedFiles
	if skipped == nil {
		skipped = []string{}
	}
	return json.Marshal(fsRenderOutput{Path: in.Path, SkippedFiles: skipped})
}

// Plan renders a throwaway copy of path and reports one PlannedChange per
// file whose content or name would change, without touching path itself.
func (a *FSRender) Plan(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	tempCopy, err := os.MkdirTemp("", "orbit-fs-render-plan-*")
	if err != nil {
		return nil, fmt.Errorf("fs:render: create temp copy: %w", err)
	}
	defer func() { _ = os.RemoveAll(tempCopy) }()

	return a.PlanPreview(ctx, rc, input, tempCopy)
}

// PlanPreview implements scaffolder.PlanPreviewer: it renders a copy of path
// into destDir, which the caller owns, so the rendered tree survives the call
// and can be persisted for the dry-run diff viewer.
func (a *FSRender) PlanPreview(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage, destDir string) ([]scaffolder.PlannedChange, error) {
	in, err := parseFSRenderInput(input)
	if err != nil {
		return nil, err
	}
	if err := requireWithinWorkDir(rc.WorkDir, in.Path); err != nil {
		return nil, fmt.Errorf("fs:render: %w: %v", scaffolder.ErrInvalidInput, err)
	}
	if strings.TrimSpace(destDir) == "" {
		return nil, fmt.Errorf("fs:render: a preview destination directory is required")
	}

	if err := copyDir(in.Path, destDir); err != nil {
		return nil, fmt.Errorf("fs:render: copy source for planning: %w", err)
	}

	rawPatterns := activities.LoadRawFilePatterns(destDir, rc.Logger)
	res, err := templating.RenderDir(destDir, in.Values, rawPatterns, rc.Logger)
	if err != nil {
		return nil, fmt.Errorf("fs:render: %w", err)
	}

	return renderPlanChanges(res), nil
}

// renderPlanChanges turns a RenderDirResult into one PlannedChange per file
// that would end up changed and/or renamed, using each file's final
// (post-rename) relative path as the change name.
func renderPlanChanges(res *templating.RenderDirResult) []scaffolder.PlannedChange {
	changed := make(map[string]bool, len(res.ChangedFiles))
	for _, p := range res.ChangedFiles {
		changed[p] = true
	}

	relPaths := append(append([]string{}, res.ChangedFiles...), keysOf(res.RenamedFiles)...)
	sort.Strings(relPaths)

	changes := make([]scaffolder.PlannedChange, 0, len(changed)+len(res.RenamedFiles))
	seen := make(map[string]bool, len(changed)+len(res.RenamedFiles))
	for _, relPath := range relPaths {
		if seen[relPath] {
			continue
		}
		seen[relPath] = true

		finalPath := relPath
		var desc string
		newPath, renamed := res.RenamedFiles[relPath]
		switch {
		case renamed && changed[relPath]:
			finalPath = newPath
			desc = fmt.Sprintf("update content and rename %s -> %s", relPath, newPath)
		case renamed:
			finalPath = newPath
			desc = fmt.Sprintf("rename %s -> %s", relPath, newPath)
		default:
			desc = fmt.Sprintf("update content of %s", relPath)
		}
		changes = append(changes, scaffolder.PlannedChange{Kind: "file", Name: finalPath, Description: desc})
	}
	return changes
}

func keysOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func parseFSRenderInput(raw json.RawMessage) (fsRenderInput, error) {
	var in fsRenderInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("fs:render: %w: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	if strings.TrimSpace(in.Path) == "" {
		return in, fmt.Errorf("fs:render: %w: `path` is required", scaffolder.ErrInvalidInput)
	}
	if len(in.Values) == 0 {
		return in, fmt.Errorf("fs:render: %w: `values` is required", scaffolder.ErrInvalidInput)
	}
	return in, nil
}

// copyDir recursively copies src into dst (created if needed). Symlinks are
// recreated as symlinks (their target string copied, not dereferenced) so a
// dangling or absolute-path symlink in src cannot cause this to read outside
// src.
func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if rel == "." {
			return os.MkdirAll(target, 0755)
		}

		switch {
		case d.Type()&fs.ModeSymlink != 0:
			linkTarget, err := os.Readlink(path)
			if err != nil {
				return fmt.Errorf("read symlink %s: %w", path, err)
			}
			return os.Symlink(linkTarget, target)
		case d.IsDir():
			return os.MkdirAll(target, 0755)
		default:
			return copyFile(path, target, d)
		}
	})
}

func copyFile(src, dst string, d fs.DirEntry) error {
	info, err := d.Info()
	if err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	defer func() { _ = out.Close() }()

	_, err = io.Copy(out, in)
	return err
}
