// Package contract holds gRPC contract tests written test-first (TDD) against
// service endpoints that must be running (localhost:8001/8002) and, in some
// files, against generated client APIs that do not exist yet. They cannot
// compile or pass in a plain `go test ./...`, so every test file is behind the
// `integration` build tag. Run them with:
//
//	go test -tags integration ./tests/contract/...
//
// Known state: with the tag, this package currently fails to build because
// getWorkspaceServiceClient is declared in both workspace_test.go and
// workspace_tdd_test.go (tracked as follow-up to issue #159).
package contract
