package actions_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder/actions"
)

// checkedInDescriptorsPath is the file the repository service embeds to serve
// TemplateService.ListActions. It is read across the module boundary (a plain
// file read, not an import) precisely because that service cannot import
// temporal-workflows/internal/....
const checkedInDescriptorsPath = "../../../../services/repository/internal/grpc/scaffolder_actions.json"

// TestScaffolderDescriptorsExport_MatchesCheckedInFile is the drift guard for
// the generated descriptor file. Adding or changing an action's schema without
// regenerating would otherwise leave the authoring UI validating against a
// registry the worker no longer has.
func TestScaffolderDescriptorsExport_MatchesCheckedInFile(t *testing.T) {
	generated, err := scaffolder.ExportDescriptorsJSON(actions.DescriptorActions())
	require.NoError(t, err)

	onDisk, err := os.ReadFile(filepath.Clean(checkedInDescriptorsPath))
	require.NoError(t, err, "checked-in descriptor file is missing")

	assert.Equal(t, string(generated)+"\n", string(onDisk),
		"scaffolder_actions.json is stale — regenerate with:\n"+
			"  cd temporal-workflows && go run ./cmd/scaffolder-descriptors > ../services/repository/internal/grpc/scaffolder_actions.json")
}

// TestDescriptorActions_CoversEveryDefaultAction keeps the descriptor list from
// silently falling behind DefaultActions: a new action added to the worker but
// not to DescriptorActions would never reach the authoring UI.
func TestDescriptorActions_CoversEveryDefaultAction(t *testing.T) {
	// Fully-wired deps produce the largest DefaultActions set.
	full := scaffolder.NewRegistry(actions.DefaultActions(actions.Deps{
		TokenService:        stubTokenService{},
		CatalogClient:       stubCatalogClient{},
		ADOConnectionClient: stubADOConnectionClient{},
		ApiSchemaClient:     stubApiSchemaClient{},
		SkeletonClient:      stubSkeletonClient{},
	})...)
	descriptors := scaffolder.NewRegistry(actions.DescriptorActions()...)

	assert.Equal(t, full.Names(), descriptors.Names())
}
