package activities

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

type fakeTemplateVersionResolver struct {
	definitions map[string]services.TemplateDefinitionSummary
	versions    map[string]services.TemplateDefinitionVersion

	getDefinitionErr        error
	getDefinitionVersionErr error

	definitionCalls []string
	versionCalls    []string
}

func (f *fakeTemplateVersionResolver) GetDefinition(_ context.Context, id string) (services.TemplateDefinitionSummary, error) {
	f.definitionCalls = append(f.definitionCalls, id)
	if f.getDefinitionErr != nil {
		return services.TemplateDefinitionSummary{}, f.getDefinitionErr
	}
	def, ok := f.definitions[id]
	if !ok {
		return services.TemplateDefinitionSummary{}, services.ErrTemplateDefinitionNotFound
	}
	return def, nil
}

func (f *fakeTemplateVersionResolver) GetDefinitionVersion(_ context.Context, id string) (services.TemplateDefinitionVersion, error) {
	f.versionCalls = append(f.versionCalls, id)
	if f.getDefinitionVersionErr != nil {
		return services.TemplateDefinitionVersion{}, f.getDefinitionVersionErr
	}
	v, ok := f.versions[id]
	if !ok {
		return services.TemplateDefinitionVersion{}, services.ErrTemplateDefinitionVersionNotFound
	}
	return v, nil
}

func validDefinitionJSON(t *testing.T, name string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"apiVersion": "orbit/v2",
		"kind":       "Template",
		"metadata":   map[string]any{"name": name, "title": name, "owner": "platform"},
		"spec":       map[string]any{"parameters": []any{}, "steps": []any{}},
	})
	require.NoError(t, err)
	return raw
}

func TestScaffolderFetchTemplateActivities_ResolveTemplateVersion(t *testing.T) {
	t.Run("current version of a published definition resolves", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "published", CurrentVersionID: "ver-2"},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				"ver-2": {ID: "ver-2", DefinitionID: "def-1", WorkspaceID: "ws-1", DefinitionJSON: validDefinitionJSON(t, "svc")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		res, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
		})

		require.NoError(t, err)
		assert.Equal(t, "ver-2", res.DefinitionVersionID)
		assert.Equal(t, "def-1", res.DefinitionID)
		assert.Equal(t, "svc", res.Definition.Metadata.Name)
		assert.Equal(t, []string{"def-1"}, fake.definitionCalls, "GetDefinition must run before resolving the current version")
	})

	t.Run("pinned version of a published definition resolves", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "published", CurrentVersionID: "ver-3"},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				"ver-1": {ID: "ver-1", DefinitionID: "def-1", WorkspaceID: "ws-1", DefinitionJSON: validDefinitionJSON(t, "svc-v1")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		res, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
			Version:              "ver-1",
		})

		require.NoError(t, err)
		assert.Equal(t, "ver-1", res.DefinitionVersionID, "the pinned version wins over currentVersionId")
	})

	t.Run("pinned version of a draft definition is rejected", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "draft", CurrentVersionID: ""},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				"ver-1": {ID: "ver-1", DefinitionID: "def-1", WorkspaceID: "ws-1", DefinitionJSON: validDefinitionJSON(t, "svc")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
			Version:              "ver-1",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "not published")
		assert.Empty(t, fake.versionCalls, "the version must never be fetched once the owning definition fails the published check")
	})

	t.Run("pinned version of a deprecated definition is rejected", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "deprecated", CurrentVersionID: "ver-1"},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				"ver-1": {ID: "ver-1", DefinitionID: "def-1", WorkspaceID: "ws-1", DefinitionJSON: validDefinitionJSON(t, "svc")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
			Version:              "ver-1",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "not published")
	})

	t.Run("version belonging to a different definition is rejected", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "published", CurrentVersionID: "ver-1"},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				// ver-9 exists, but belongs to a different definition (def-9).
				"ver-9": {ID: "ver-9", DefinitionID: "def-9", WorkspaceID: "ws-1", DefinitionJSON: validDefinitionJSON(t, "other")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
			Version:              "ver-9",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "does not belong to template")
	})

	t.Run("definition belonging to a different workspace is rejected", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-other", Status: "published", CurrentVersionID: "ver-1"},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				"ver-1": {ID: "ver-1", DefinitionID: "def-1", WorkspaceID: "ws-other", DefinitionJSON: validDefinitionJSON(t, "svc")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "different workspace")
		assert.Empty(t, fake.versionCalls, "must fail before ever fetching a version from another tenant")
	})

	t.Run("version belonging to a different workspace than the request is rejected", func(t *testing.T) {
		// The definition itself checks out (ws-1), but the version doc
		// (fetched by a caller-pinned id) claims a different workspace —
		// e.g. a stale/forged version id. Defense in depth alongside the
		// definition-level check above.
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "published", CurrentVersionID: "ver-1"},
			},
			versions: map[string]services.TemplateDefinitionVersion{
				"ver-1": {ID: "ver-1", DefinitionID: "def-1", WorkspaceID: "ws-other", DefinitionJSON: validDefinitionJSON(t, "svc")},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
			Version:              "ver-1",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "different workspace")
	})

	t.Run("a definition with no published version and no pin fails", func(t *testing.T) {
		fake := &fakeTemplateVersionResolver{
			definitions: map[string]services.TemplateDefinitionSummary{
				"def-1": {ID: "def-1", WorkspaceID: "ws-1", Status: "published", CurrentVersionID: ""},
			},
		}
		a := NewScaffolderFetchTemplateActivities(fake, nil)

		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID:          "ws-1",
			TemplateDefinitionID: "def-1",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "no published version")
	})

	t.Run("missing required fields is non-retryable", func(t *testing.T) {
		a := NewScaffolderFetchTemplateActivities(&fakeTemplateVersionResolver{}, nil)
		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{})
		require.Error(t, err)
	})

	t.Run("nil client fails loudly", func(t *testing.T) {
		a := NewScaffolderFetchTemplateActivities(nil, nil)
		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID: "ws-1", TemplateDefinitionID: "def-1",
		})
		require.Error(t, err)
	})

	t.Run("definition not found is non-retryable", func(t *testing.T) {
		a := NewScaffolderFetchTemplateActivities(&fakeTemplateVersionResolver{}, nil)
		_, err := a.ResolveTemplateVersion(context.Background(), ScaffolderResolveTemplateVersionInput{
			WorkspaceID: "ws-1", TemplateDefinitionID: "missing",
		})
		require.Error(t, err)
	})
}
