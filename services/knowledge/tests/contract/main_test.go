/**
 * Knowledge Service Contract Tests Setup
 * 
 * This file provides common configuration and constants for contract tests.
 * All Knowledge service contract tests in this package will use these settings.
 */

package contract

import (
	"os"
	"testing"
)

const (
	// Knowledge service gRPC endpoint for contract testing
	KnowledgeServiceAddr = "localhost:8004"
)

func TestMain(m *testing.M) {
	// TDD Phase: Services are not yet implemented
	// These tests will fail with "connection refused" until services are started
	
	// Set up test logging
	os.Setenv("GOLOG_LEVEL", "debug")
	
	// Run all contract tests
	code := m.Run()
	
	// Clean up any test resources if needed
	os.Exit(code)
}