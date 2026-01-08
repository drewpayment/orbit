// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/TopicACLFilter.kt
package io.orbit.bifrost.filter

import io.orbit.bifrost.acl.ACLStore
import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse
import org.apache.kafka.common.requests.FetchRequest
import org.apache.kafka.common.requests.ProduceRequest

private val logger = KotlinLogging.logger {}

/**
 * Enforces topic-level ACLs for cross-application sharing.
 *
 * This filter runs AFTER TopicRewriteFilter (order 15 vs order 10) to check
 * access permissions on the physical topic names.
 *
 * Access control logic:
 * - Topics within the credential's own prefix (context.topicPrefix) pass through
 *   without ACL check - these are "own" topics
 * - Topics outside the prefix require explicit ACL grant from ACLStore
 * - For FETCH requests: requires "read" permission
 * - For PRODUCE requests: requires "write" permission
 *
 * On authorization failure, returns error code 29 (TOPIC_AUTHORIZATION_FAILED).
 */
class TopicACLFilter(private val aclStore: ACLStore) : BifrostFilter {
    override val name = "TopicACLFilter"
    override val order = 15  // Run after TopicRewriteFilter (order 10)

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        // Only check FETCH and PRODUCE requests
        val key = apiKey.toInt()
        if (key != ApiKeys.FETCH.id.toInt() && key != ApiKeys.PRODUCE.id.toInt()) {
            return FilterResult.Pass(request)
        }

        // If no credential ID, let other auth filters handle it
        val credentialId = context.credentialId
        if (credentialId == null) {
            logger.debug { "No credential ID in context, passing through" }
            return FilterResult.Pass(request)
        }

        val topicPrefix = context.topicPrefix
        val requiredPermission = if (key == ApiKeys.FETCH.id.toInt()) "read" else "write"

        // Extract topics from the request
        val topics = extractTopics(apiKey, request)
        if (topics.isEmpty()) {
            return FilterResult.Pass(request)
        }

        // Check each topic
        for (topic in topics) {
            // Own topics (with our prefix) pass through
            if (topic.startsWith(topicPrefix) && topicPrefix.isNotEmpty()) {
                logger.debug { "Topic '$topic' is owned by credential, allowing access" }
                continue
            }

            // Foreign topics require ACL check
            val hasPermission = aclStore.hasPermission(credentialId, topic, requiredPermission)
            if (!hasPermission) {
                logger.info {
                    "Access denied: credential '$credentialId' lacks '$requiredPermission' " +
                    "permission on topic '$topic'"
                }
                return FilterResult.Reject(
                    errorCode = TOPIC_AUTHORIZATION_FAILED,
                    message = "Access denied to topic '$topic': missing '$requiredPermission' permission"
                )
            }
            logger.debug { "Topic '$topic' authorized via ACL for credential '$credentialId'" }
        }

        return FilterResult.Pass(request)
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        // ACL checking is only done on requests, not responses
        return FilterResult.Pass(response)
    }

    /**
     * Extracts topic names from FETCH or PRODUCE requests.
     */
    private fun extractTopics(apiKey: Short, request: AbstractRequest): List<String> {
        return when (apiKey.toInt()) {
            ApiKeys.FETCH.id.toInt() -> {
                val fetchRequest = request as FetchRequest
                fetchRequest.data().topics().map { it.topic() }
            }
            ApiKeys.PRODUCE.id.toInt() -> {
                val produceRequest = request as ProduceRequest
                produceRequest.data().topicData().map { it.name() }
            }
            else -> emptyList()
        }
    }

    companion object {
        // Kafka error code for TOPIC_AUTHORIZATION_FAILED
        const val TOPIC_AUTHORIZATION_FAILED: Short = 29
    }
}
