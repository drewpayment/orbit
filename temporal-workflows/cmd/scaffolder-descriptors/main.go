// Command scaffolder-descriptors prints the scaffolder action registry's
// descriptors as JSON.
//
// The repository service serves TemplateService.ListActions from the generated
// file rather than from the registry itself: temporal-workflows/internal/... is
// not importable across the module boundary, and depending on the worker module
// would pull the Temporal SDK and minio into a service that only needs a set of
// static JSON schemas.
//
// Regenerate with:
//
//	cd temporal-workflows && go run ./cmd/scaffolder-descriptors \
//	  > ../services/repository/internal/grpc/scaffolder_actions.json
//
// TestScaffolderDescriptorsExport_MatchesCheckedInFile fails when the checked-in
// file drifts from the registry.
package main

import (
	"fmt"
	"os"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder/actions"
)

func main() {
	out, err := scaffolder.ExportDescriptorsJSON(actions.DescriptorActions())
	if err != nil {
		fmt.Fprintf(os.Stderr, "scaffolder-descriptors: %v\n", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(append(out, '\n')); err != nil {
		fmt.Fprintf(os.Stderr, "scaffolder-descriptors: %v\n", err)
		os.Exit(1)
	}
}
