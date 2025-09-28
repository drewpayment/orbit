package contract

import (
	"testing"
	
	"github.com/stretchr/testify/assert"
	workspacepb "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
	repositorypb "github.com/drewpayment/orbit/proto/gen/go/idp/repository/v1"
	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
	paginationpb "github.com/drewpayment/orbit/proto/gen/go/idp/pagination/v1"
)

func TestImportsWork(t *testing.T) {
	// This test just verifies that our protobuf imports compile correctly
	// This should pass, showing that protobuf generation worked
	
	t.Log("Testing basic protobuf imports...")
	
	// Test workspace protobuf
	workspace := &workspacepb.Workspace{}
	assert.NotNil(t, workspace)
	
	// Test repository protobuf
	repo := &repositorypb.Repository{}
	assert.NotNil(t, repo)
	
	// Test common protobuf
	metadata := &commonpb.EntityMetadata{}
	assert.NotNil(t, metadata)
	
	// Test pagination protobuf
	page := &paginationpb.PaginationRequest{}
	assert.NotNil(t, page)
	
	t.Log("✅ All protobuf imports work correctly!")
}