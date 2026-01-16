package apache

import (
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/twmb/franz-go/pkg/kmsg"
)

func TestMapResourceType(t *testing.T) {
	tests := []struct {
		input    adapters.ResourceType
		expected kmsg.ACLResourceType
	}{
		{adapters.ResourceTypeTopic, kmsg.ACLResourceTypeTopic},
		{adapters.ResourceTypeGroup, kmsg.ACLResourceTypeGroup},
		{adapters.ResourceTypeCluster, kmsg.ACLResourceTypeCluster},
		{adapters.ResourceTypeTransactional, kmsg.ACLResourceTypeTransactionalId},
	}

	for _, tt := range tests {
		t.Run(string(tt.input), func(t *testing.T) {
			result := mapResourceType(tt.input)
			if result != tt.expected {
				t.Errorf("mapResourceType(%s) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapResourceTypeFromKmsg(t *testing.T) {
	tests := []struct {
		input    kmsg.ACLResourceType
		expected adapters.ResourceType
	}{
		{kmsg.ACLResourceTypeTopic, adapters.ResourceTypeTopic},
		{kmsg.ACLResourceTypeGroup, adapters.ResourceTypeGroup},
		{kmsg.ACLResourceTypeCluster, adapters.ResourceTypeCluster},
		{kmsg.ACLResourceTypeTransactionalId, adapters.ResourceTypeTransactional},
	}

	for _, tt := range tests {
		t.Run(tt.input.String(), func(t *testing.T) {
			result := mapResourceTypeFromKmsg(tt.input)
			if result != tt.expected {
				t.Errorf("mapResourceTypeFromKmsg(%v) = %s, want %s", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapPatternType(t *testing.T) {
	tests := []struct {
		input    adapters.PatternType
		expected kmsg.ACLResourcePatternType
	}{
		{adapters.PatternTypeLiteral, kmsg.ACLResourcePatternTypeLiteral},
		{adapters.PatternTypePrefixed, kmsg.ACLResourcePatternTypePrefixed},
	}

	for _, tt := range tests {
		t.Run(string(tt.input), func(t *testing.T) {
			result := mapPatternType(tt.input)
			if result != tt.expected {
				t.Errorf("mapPatternType(%s) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapPatternTypeFromKmsg(t *testing.T) {
	tests := []struct {
		input    kmsg.ACLResourcePatternType
		expected adapters.PatternType
	}{
		{kmsg.ACLResourcePatternTypeLiteral, adapters.PatternTypeLiteral},
		{kmsg.ACLResourcePatternTypePrefixed, adapters.PatternTypePrefixed},
	}

	for _, tt := range tests {
		t.Run(tt.input.String(), func(t *testing.T) {
			result := mapPatternTypeFromKmsg(tt.input)
			if result != tt.expected {
				t.Errorf("mapPatternTypeFromKmsg(%v) = %s, want %s", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapOperation(t *testing.T) {
	tests := []struct {
		input    adapters.ACLOperation
		expected kmsg.ACLOperation
	}{
		{adapters.ACLOperationAll, kmsg.ACLOperationAll},
		{adapters.ACLOperationRead, kmsg.ACLOperationRead},
		{adapters.ACLOperationWrite, kmsg.ACLOperationWrite},
		{adapters.ACLOperationCreate, kmsg.ACLOperationCreate},
		{adapters.ACLOperationDelete, kmsg.ACLOperationDelete},
		{adapters.ACLOperationAlter, kmsg.ACLOperationAlter},
		{adapters.ACLOperationDescribe, kmsg.ACLOperationDescribe},
		{adapters.ACLOperationClusterAction, kmsg.ACLOperationClusterAction},
		{adapters.ACLOperationDescribeConfigs, kmsg.ACLOperationDescribeConfigs},
		{adapters.ACLOperationAlterConfigs, kmsg.ACLOperationAlterConfigs},
		{adapters.ACLOperationIdempotentWrite, kmsg.ACLOperationIdempotentWrite},
	}

	for _, tt := range tests {
		t.Run(string(tt.input), func(t *testing.T) {
			result := mapOperation(tt.input)
			if result != tt.expected {
				t.Errorf("mapOperation(%s) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapOperationFromKmsg(t *testing.T) {
	tests := []struct {
		input    kmsg.ACLOperation
		expected adapters.ACLOperation
	}{
		{kmsg.ACLOperationAll, adapters.ACLOperationAll},
		{kmsg.ACLOperationRead, adapters.ACLOperationRead},
		{kmsg.ACLOperationWrite, adapters.ACLOperationWrite},
		{kmsg.ACLOperationCreate, adapters.ACLOperationCreate},
		{kmsg.ACLOperationDelete, adapters.ACLOperationDelete},
		{kmsg.ACLOperationAlter, adapters.ACLOperationAlter},
		{kmsg.ACLOperationDescribe, adapters.ACLOperationDescribe},
		{kmsg.ACLOperationClusterAction, adapters.ACLOperationClusterAction},
		{kmsg.ACLOperationDescribeConfigs, adapters.ACLOperationDescribeConfigs},
		{kmsg.ACLOperationAlterConfigs, adapters.ACLOperationAlterConfigs},
		{kmsg.ACLOperationIdempotentWrite, adapters.ACLOperationIdempotentWrite},
	}

	for _, tt := range tests {
		t.Run(tt.input.String(), func(t *testing.T) {
			result := mapOperationFromKmsg(tt.input)
			if result != tt.expected {
				t.Errorf("mapOperationFromKmsg(%v) = %s, want %s", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapPermissionType(t *testing.T) {
	tests := []struct {
		input    adapters.ACLPermissionType
		expected bool // true = allow, false = deny
	}{
		{adapters.ACLPermissionAllow, true},
		{adapters.ACLPermissionDeny, false},
	}

	for _, tt := range tests {
		t.Run(string(tt.input), func(t *testing.T) {
			result := isAllowPermission(tt.input)
			if result != tt.expected {
				t.Errorf("isAllowPermission(%s) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestMapPermissionTypeFromKmsg(t *testing.T) {
	tests := []struct {
		input    kmsg.ACLPermissionType
		expected adapters.ACLPermissionType
	}{
		{kmsg.ACLPermissionTypeAllow, adapters.ACLPermissionAllow},
		{kmsg.ACLPermissionTypeDeny, adapters.ACLPermissionDeny},
	}

	for _, tt := range tests {
		t.Run(tt.input.String(), func(t *testing.T) {
			result := mapPermissionTypeFromKmsg(tt.input)
			if result != tt.expected {
				t.Errorf("mapPermissionTypeFromKmsg(%v) = %s, want %s", tt.input, result, tt.expected)
			}
		})
	}
}
