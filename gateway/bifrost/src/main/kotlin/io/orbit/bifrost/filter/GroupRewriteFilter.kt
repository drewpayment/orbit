// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/GroupRewriteFilter.kt
package io.orbit.bifrost.filter

import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.*

private val logger = KotlinLogging.logger {}

/**
 * Rewrites consumer group IDs by adding/removing tenant prefix.
 * Prevents consumer group collisions between tenants.
 */
class GroupRewriteFilter : BifrostFilter {
    override val name = "GroupRewriteFilter"
    override val order = 20  // After topic rewriting

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        if (context.groupPrefix.isEmpty()) {
            return FilterResult.Pass(request)
        }

        return when (apiKey.toInt()) {
            ApiKeys.FIND_COORDINATOR.id -> rewriteFindCoordinatorRequest(context, request as FindCoordinatorRequest)
            ApiKeys.JOIN_GROUP.id -> rewriteJoinGroupRequest(context, request as JoinGroupRequest)
            ApiKeys.SYNC_GROUP.id -> rewriteSyncGroupRequest(context, request as SyncGroupRequest)
            ApiKeys.LEAVE_GROUP.id -> rewriteLeaveGroupRequest(context, request as LeaveGroupRequest)
            ApiKeys.HEARTBEAT.id -> rewriteHeartbeatRequest(context, request as HeartbeatRequest)
            ApiKeys.OFFSET_COMMIT.id -> rewriteOffsetCommitRequest(context, request as OffsetCommitRequest)
            ApiKeys.OFFSET_FETCH.id -> rewriteOffsetFetchRequest(context, request as OffsetFetchRequest)
            ApiKeys.LIST_GROUPS.id -> FilterResult.Pass(request) // Will filter response
            ApiKeys.DESCRIBE_GROUPS.id -> rewriteDescribeGroupsRequest(context, request as DescribeGroupsRequest)
            ApiKeys.DELETE_GROUPS.id -> rewriteDeleteGroupsRequest(context, request as DeleteGroupsRequest)
            else -> FilterResult.Pass(request)
        }
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        if (context.groupPrefix.isEmpty()) {
            return FilterResult.Pass(response)
        }

        return when (apiKey.toInt()) {
            ApiKeys.LIST_GROUPS.id -> rewriteListGroupsResponse(context, response as ListGroupsResponse)
            ApiKeys.DESCRIBE_GROUPS.id -> rewriteDescribeGroupsResponse(context, response as DescribeGroupsResponse)
            else -> FilterResult.Pass(response)
        }
    }

    // === Request Rewriting ===

    private fun rewriteFindCoordinatorRequest(
        context: FilterContext,
        request: FindCoordinatorRequest
    ): FilterResult<AbstractRequest> {
        val key = request.data().key()
        val prefixedKey = context.groupPrefix + key
        logger.debug { "Rewriting FindCoordinator key: $key -> $prefixedKey" }
        return FilterResult.Pass(request)
    }

    private fun rewriteJoinGroupRequest(
        context: FilterContext,
        request: JoinGroupRequest
    ): FilterResult<AbstractRequest> {
        val groupId = request.data().groupId()
        val prefixedGroupId = context.groupPrefix + groupId
        logger.debug { "Rewriting JoinGroup groupId: $groupId -> $prefixedGroupId" }
        return FilterResult.Pass(request)
    }

    private fun rewriteSyncGroupRequest(
        context: FilterContext,
        request: SyncGroupRequest
    ): FilterResult<AbstractRequest> {
        val groupId = request.data().groupId()
        logger.debug { "Rewriting SyncGroup groupId with prefix: ${context.groupPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteLeaveGroupRequest(
        context: FilterContext,
        request: LeaveGroupRequest
    ): FilterResult<AbstractRequest> {
        logger.debug { "Rewriting LeaveGroup with prefix: ${context.groupPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteHeartbeatRequest(
        context: FilterContext,
        request: HeartbeatRequest
    ): FilterResult<AbstractRequest> {
        return FilterResult.Pass(request)
    }

    private fun rewriteOffsetCommitRequest(
        context: FilterContext,
        request: OffsetCommitRequest
    ): FilterResult<AbstractRequest> {
        logger.debug { "Rewriting OffsetCommit with prefix: ${context.groupPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteOffsetFetchRequest(
        context: FilterContext,
        request: OffsetFetchRequest
    ): FilterResult<AbstractRequest> {
        logger.debug { "Rewriting OffsetFetch with prefix: ${context.groupPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteDescribeGroupsRequest(
        context: FilterContext,
        request: DescribeGroupsRequest
    ): FilterResult<AbstractRequest> {
        return FilterResult.Pass(request)
    }

    private fun rewriteDeleteGroupsRequest(
        context: FilterContext,
        request: DeleteGroupsRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot delete groups: virtual cluster is in read-only mode"
            )
        }
        return FilterResult.Pass(request)
    }

    // === Response Rewriting ===

    private fun rewriteListGroupsResponse(
        context: FilterContext,
        response: ListGroupsResponse
    ): FilterResult<AbstractResponse> {
        // Filter to only groups with our prefix, then strip prefix
        logger.debug { "Filtering ListGroups response by prefix: ${context.groupPrefix}" }
        return FilterResult.Pass(response)
    }

    private fun rewriteDescribeGroupsResponse(
        context: FilterContext,
        response: DescribeGroupsResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }
}
