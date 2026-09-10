package templating

import (
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// RenderDirResult reports what RenderDir did.
type RenderDirResult struct {
	// SkippedFiles are absolute paths that could not be rendered as a
	// template (content or name) and were left byte-for-byte unmodified.
	SkippedFiles []string
	// ChangedFiles are workDir-relative paths (post-rename) whose content
	// changed.
	ChangedFiles []string
	// RenamedFiles maps a workDir-relative old path to its new path, for
	// every path whose base name changed.
	RenamedFiles map[string]string
}

// isBinaryContent applies a null-byte heuristic to a content sample.
func isBinaryContent(content []byte) bool {
	sampleSize := 512
	if len(content) < sampleSize {
		sampleSize = len(content)
	}
	return strings.Contains(string(content[:sampleSize]), "\x00")
}

// IsSafeRenderedName reports whether a rendered file/dir name is safe to use
// as a single path segment: non-empty and free of path separators or ".."
// (guards against a malicious/misconfigured template variable value, e.g.
// {"SERVICE_NAME": "../../etc"}, escaping the work directory via rename).
func IsSafeRenderedName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	return !strings.ContainsAny(name, `/\`)
}

// matchesRawFilePattern reports whether relPath matches any of the given
// filepath.Match glob patterns. Patterns are single-segment (no `**`); a
// pattern like "charts/*.yaml" matches "charts/values.yaml" but not
// "charts/nested/values.yaml" — filepath.Match's documented limitation.
func matchesRawFilePattern(relPath string, patterns []string) bool {
	for _, pattern := range patterns {
		if ok, err := filepath.Match(pattern, relPath); err == nil && ok {
			return true
		}
	}
	return false
}

// RenderDir substitutes vars into file contents and file/directory names
// throughout workDir, in place, using Render/RenderName. Files matching a
// rawPatterns glob are skipped entirely (content and name). A file that
// fails to parse/execute as a template is left unmodified and reported in
// the result's SkippedFiles; this is not a fatal condition.
//
// This is the single implementation behind the v1 ApplyTemplateVariables
// activity and the fs:render scaffolder action — both call it so template
// rendering behaves identically everywhere it runs.
func RenderDir(workDir string, vars map[string]string, rawPatterns []string, logger *slog.Logger) (*RenderDirResult, error) {
	if logger == nil {
		logger = slog.Default()
	}
	result := &RenderDirResult{RenamedFiles: map[string]string{}}

	// No variables means no bare tokens can match and no dot-context is
	// meaningful; skip entirely rather than attempting to parse arbitrary
	// Go-template syntax in files that were never meant to be rendered.
	if len(vars) == 0 {
		return result, nil
	}

	var allPaths []string

	// Pass 1: content substitution (top-down walk). Collect every visited
	// path (files and dirs) along the way for the rename pass below.
	err := filepath.WalkDir(workDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path != workDir {
			allPaths = append(allPaths, path)
		}
		if d.IsDir() {
			return nil
		}
		// Symlinks: do not follow, do not attempt to render their target
		// content (a dangling or absolute-path symlink could point outside
		// workDir); treat like a raw/binary file for content purposes.
		if d.Type()&fs.ModeSymlink != 0 {
			logger.Debug("Skipping content render for symlink", "path", path)
			return nil
		}

		relPath, relErr := filepath.Rel(workDir, path)
		if relErr != nil {
			return fmt.Errorf("failed to compute relative path for %s: %w", path, relErr)
		}
		if matchesRawFilePattern(relPath, rawPatterns) {
			logger.Debug("Skipping raw-file-matched content", "path", relPath)
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}
		if isBinaryContent(content) {
			logger.Debug("Skipping binary file content", "path", path)
			return nil
		}

		rendered, renderErr := Render(string(content), vars)
		if renderErr != nil {
			logger.Warn("Failed to render template file, leaving unchanged", "path", path, "error", renderErr)
			result.SkippedFiles = append(result.SkippedFiles, path)
			return nil
		}

		if rendered != string(content) {
			info, statErr := d.Info()
			if statErr != nil {
				return fmt.Errorf("failed to stat file %s: %w", path, statErr)
			}
			if err := os.WriteFile(path, []byte(rendered), info.Mode().Perm()); err != nil {
				return fmt.Errorf("failed to write file %s: %w", path, err)
			}
			result.ChangedFiles = append(result.ChangedFiles, relPath)
			logger.Debug("Applied variables to file", "path", path)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to apply template variables: %w", err)
	}

	// Pass 2: rename file/dir base names, deepest-first. allPaths was
	// collected in top-down (pre-)order by WalkDir, so iterating it in
	// reverse visits children before their parents — a valid bottom-up
	// order without a second directory walk.
	for i := len(allPaths) - 1; i >= 0; i-- {
		oldPath := allPaths[i]
		dir := filepath.Dir(oldPath)
		base := filepath.Base(oldPath)

		relPath, relErr := filepath.Rel(workDir, oldPath)
		if relErr != nil {
			logger.Warn("Failed to compute relative path for rename, skipping", "path", oldPath, "error", relErr)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}
		if matchesRawFilePattern(relPath, rawPatterns) {
			continue
		}

		newBase, renderErr := RenderName(base, vars)
		if renderErr != nil {
			logger.Warn("Failed to render name, leaving unchanged", "path", oldPath, "error", renderErr)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}
		if newBase == base {
			continue
		}
		if !IsSafeRenderedName(newBase) {
			logger.Warn("Rendered name is unsafe (path separator or '..'), leaving unchanged", "path", oldPath, "renderedName", newBase)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}

		newPath := filepath.Join(dir, newBase)

		// Guard against a silent clobber: if two paths render to the same
		// new name (e.g. two variable keys sharing a value), os.Rename
		// would otherwise overwrite whichever collision target already
		// landed there first. Skip instead of clobbering.
		if _, statErr := os.Lstat(newPath); statErr == nil {
			logger.Warn("Rename target already exists, leaving source unchanged to avoid clobbering it", "path", oldPath, "newPath", newPath)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		} else if !os.IsNotExist(statErr) {
			logger.Warn("Failed to check rename target, leaving unchanged", "path", oldPath, "newPath", newPath, "error", statErr)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}

		if err := os.Rename(oldPath, newPath); err != nil {
			logger.Warn("Failed to rename path, leaving unchanged", "path", oldPath, "newPath", newPath, "error", err)
			result.SkippedFiles = append(result.SkippedFiles, oldPath)
			continue
		}
		newRelPath, _ := filepath.Rel(workDir, newPath)
		result.RenamedFiles[relPath] = newRelPath
		logger.Debug("Renamed path", "oldPath", oldPath, "newPath", newPath)
	}

	return result, nil
}
