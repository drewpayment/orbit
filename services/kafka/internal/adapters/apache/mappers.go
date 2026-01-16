package apache

import (
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/twmb/franz-go/pkg/kmsg"
)

// mapResourceType converts adapters.ResourceType to kmsg.ACLResourceType
func mapResourceType(rt adapters.ResourceType) kmsg.ACLResourceType {
	switch rt {
	case adapters.ResourceTypeTopic:
		return kmsg.ACLResourceTypeTopic
	case adapters.ResourceTypeGroup:
		return kmsg.ACLResourceTypeGroup
	case adapters.ResourceTypeCluster:
		return kmsg.ACLResourceTypeCluster
	case adapters.ResourceTypeTransactional:
		return kmsg.ACLResourceTypeTransactionalId
	default:
		return kmsg.ACLResourceTypeUnknown
	}
}

// mapResourceTypeFromKmsg converts kmsg.ACLResourceType to adapters.ResourceType
func mapResourceTypeFromKmsg(rt kmsg.ACLResourceType) adapters.ResourceType {
	switch rt {
	case kmsg.ACLResourceTypeTopic:
		return adapters.ResourceTypeTopic
	case kmsg.ACLResourceTypeGroup:
		return adapters.ResourceTypeGroup
	case kmsg.ACLResourceTypeCluster:
		return adapters.ResourceTypeCluster
	case kmsg.ACLResourceTypeTransactionalId:
		return adapters.ResourceTypeTransactional
	default:
		return ""
	}
}

// mapPatternType converts adapters.PatternType to kmsg.ACLResourcePatternType
func mapPatternType(pt adapters.PatternType) kmsg.ACLResourcePatternType {
	switch pt {
	case adapters.PatternTypeLiteral:
		return kmsg.ACLResourcePatternTypeLiteral
	case adapters.PatternTypePrefixed:
		return kmsg.ACLResourcePatternTypePrefixed
	default:
		return kmsg.ACLResourcePatternTypeLiteral
	}
}

// mapPatternTypeFromKmsg converts kmsg.ACLResourcePatternType to adapters.PatternType
func mapPatternTypeFromKmsg(pt kmsg.ACLResourcePatternType) adapters.PatternType {
	switch pt {
	case kmsg.ACLResourcePatternTypeLiteral:
		return adapters.PatternTypeLiteral
	case kmsg.ACLResourcePatternTypePrefixed:
		return adapters.PatternTypePrefixed
	default:
		return adapters.PatternTypeLiteral
	}
}

// mapOperation converts adapters.ACLOperation to kmsg.ACLOperation
func mapOperation(op adapters.ACLOperation) kmsg.ACLOperation {
	switch op {
	case adapters.ACLOperationAll:
		return kmsg.ACLOperationAll
	case adapters.ACLOperationRead:
		return kmsg.ACLOperationRead
	case adapters.ACLOperationWrite:
		return kmsg.ACLOperationWrite
	case adapters.ACLOperationCreate:
		return kmsg.ACLOperationCreate
	case adapters.ACLOperationDelete:
		return kmsg.ACLOperationDelete
	case adapters.ACLOperationAlter:
		return kmsg.ACLOperationAlter
	case adapters.ACLOperationDescribe:
		return kmsg.ACLOperationDescribe
	case adapters.ACLOperationClusterAction:
		return kmsg.ACLOperationClusterAction
	case adapters.ACLOperationDescribeConfigs:
		return kmsg.ACLOperationDescribeConfigs
	case adapters.ACLOperationAlterConfigs:
		return kmsg.ACLOperationAlterConfigs
	case adapters.ACLOperationIdempotentWrite:
		return kmsg.ACLOperationIdempotentWrite
	default:
		return kmsg.ACLOperationUnknown
	}
}

// mapOperationFromKmsg converts kmsg.ACLOperation to adapters.ACLOperation
func mapOperationFromKmsg(op kmsg.ACLOperation) adapters.ACLOperation {
	switch op {
	case kmsg.ACLOperationAll:
		return adapters.ACLOperationAll
	case kmsg.ACLOperationRead:
		return adapters.ACLOperationRead
	case kmsg.ACLOperationWrite:
		return adapters.ACLOperationWrite
	case kmsg.ACLOperationCreate:
		return adapters.ACLOperationCreate
	case kmsg.ACLOperationDelete:
		return adapters.ACLOperationDelete
	case kmsg.ACLOperationAlter:
		return adapters.ACLOperationAlter
	case kmsg.ACLOperationDescribe:
		return adapters.ACLOperationDescribe
	case kmsg.ACLOperationClusterAction:
		return adapters.ACLOperationClusterAction
	case kmsg.ACLOperationDescribeConfigs:
		return adapters.ACLOperationDescribeConfigs
	case kmsg.ACLOperationAlterConfigs:
		return adapters.ACLOperationAlterConfigs
	case kmsg.ACLOperationIdempotentWrite:
		return adapters.ACLOperationIdempotentWrite
	default:
		return ""
	}
}

// isAllowPermission returns true if the permission type is ALLOW
func isAllowPermission(pt adapters.ACLPermissionType) bool {
	return pt == adapters.ACLPermissionAllow
}

// mapPermissionTypeFromKmsg converts kmsg.ACLPermissionType to adapters.ACLPermissionType
func mapPermissionTypeFromKmsg(pt kmsg.ACLPermissionType) adapters.ACLPermissionType {
	switch pt {
	case kmsg.ACLPermissionTypeAllow:
		return adapters.ACLPermissionAllow
	case kmsg.ACLPermissionTypeDeny:
		return adapters.ACLPermissionDeny
	default:
		return adapters.ACLPermissionDeny
	}
}
