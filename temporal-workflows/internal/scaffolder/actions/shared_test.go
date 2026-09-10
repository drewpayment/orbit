package actions

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRequireWithinWorkDir(t *testing.T) {
	workDir := t.TempDir()

	assert.NoError(t, requireWithinWorkDir(workDir, workDir))
	assert.NoError(t, requireWithinWorkDir(workDir, filepath.Join(workDir, "nested", "dir")))
	assert.Error(t, requireWithinWorkDir("", filepath.Join(workDir, "x")))
	assert.Error(t, requireWithinWorkDir(workDir, filepath.Join(filepath.Dir(workDir), "sibling")))
	assert.Error(t, requireWithinWorkDir(workDir, "/etc"))
}
