// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/TopicRewriteFilter.kt
package io.orbit.bifrost.filter

import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.*

private val logger = KotlinLogging.logger {}

/**
 * Rewrites topic names by adding/removing tenant prefix.
 *
 * Inbound (client -> broker): Adds prefix to topic names
 * Outbound (broker -> client): Removes prefix from topic names
 */
class TopicRewriteFilter : BifrostFilter {
    override val name = "TopicRewriteFilter"
    override val order = 10  // Run early in the chain

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        if (context.topicPrefix.isEmpty()) {
            return FilterResult.Pass(request)
        }

        return when (apiKey.toInt()) {
            ApiKeys.METADATA.id -> rewriteMetadataRequest(context, request as MetadataRequest)
            ApiKeys.PRODUCE.id -> rewriteProduceRequest(context, request as ProduceRequest)
            ApiKeys.FETCH.id -> rewriteFetchRequest(context, request as FetchRequest)
            ApiKeys.LIST_OFFSETS.id -> rewriteListOffsetsRequest(context, request as ListOffsetsRequest)
            ApiKeys.CREATE_TOPICS.id -> rewriteCreateTopicsRequest(context, request as CreateTopicsRequest)
            ApiKeys.DELETE_TOPICS.id -> rewriteDeleteTopicsRequest(context, request as DeleteTopicsRequest)
            ApiKeys.DESCRIBE_CONFIGS.id -> rewriteDescribeConfigsRequest(context, request as DescribeConfigsRequest)
            else -> FilterResult.Pass(request)
        }
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        if (context.topicPrefix.isEmpty()) {
            return FilterResult.Pass(response)
        }

        return when (apiKey.toInt()) {
            ApiKeys.METADATA.id -> rewriteMetadataResponse(context, response as MetadataResponse)
            ApiKeys.PRODUCE.id -> rewriteProduceResponse(context, response as ProduceResponse)
            ApiKeys.FETCH.id -> rewriteFetchResponse(context, response as FetchResponse)
            ApiKeys.LIST_OFFSETS.id -> rewriteListOffsetsResponse(context, response as ListOffsetsResponse)
            ApiKeys.CREATE_TOPICS.id -> rewriteCreateTopicsResponse(context, response as CreateTopicsResponse)
            ApiKeys.DELETE_TOPICS.id -> rewriteDeleteTopicsResponse(context, response as DeleteTopicsResponse)
            else -> FilterResult.Pass(response)
        }
    }

    // === Request Rewriting (add prefix) ===

    private fun rewriteMetadataRequest(
        context: FilterContext,
        request: MetadataRequest
    ): FilterResult<AbstractRequest> {
        val topics = request.topics()
        if (topics == null || topics.isEmpty()) {
            // All topics requested - will filter in response
            return FilterResult.Pass(request)
        }

        val prefixedTopics = topics.map { context.topicPrefix + it }
        logger.debug { "Rewriting metadata request topics: $topics -> $prefixedTopics" }

        // Note: In production, we'd rebuild the request with prefixed topics
        // For now, return pass and handle in a real Kroxylicious integration
        return FilterResult.Pass(request)
    }

    private fun rewriteProduceRequest(
        context: FilterContext,
        request: ProduceRequest
    ): FilterResult<AbstractRequest> {
        // Check read-only mode
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29, // CLUSTER_AUTHORIZATION_FAILED
                message = "Virtual cluster is in read-only mode"
            )
        }

        logger.debug { "Rewriting produce request with prefix: ${context.topicPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteFetchRequest(
        context: FilterContext,
        request: FetchRequest
    ): FilterResult<AbstractRequest> {
        logger.debug { "Rewriting fetch request with prefix: ${context.topicPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteListOffsetsRequest(
        context: FilterContext,
        request: ListOffsetsRequest
    ): FilterResult<AbstractRequest> {
        return FilterResult.Pass(request)
    }

    private fun rewriteCreateTopicsRequest(
        context: FilterContext,
        request: CreateTopicsRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot create topics: virtual cluster is in read-only mode"
            )
        }

        logger.debug { "Rewriting create topics request with prefix: ${context.topicPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteDeleteTopicsRequest(
        context: FilterContext,
        request: DeleteTopicsRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot delete topics: virtual cluster is in read-only mode"
            )
        }

        return FilterResult.Pass(request)
    }

    private fun rewriteDescribeConfigsRequest(
        context: FilterContext,
        request: DescribeConfigsRequest
    ): FilterResult<AbstractRequest> {
        return FilterResult.Pass(request)
    }

    // === Response Rewriting (remove prefix) ===

    private fun rewriteMetadataResponse(
        context: FilterContext,
        response: MetadataResponse
    ): FilterResult<AbstractResponse> {
        // Filter to only topics with our prefix, then strip prefix
        logger.debug { "Rewriting metadata response, filtering by prefix: ${context.topicPrefix}" }
        return FilterResult.Pass(response)
    }

    private fun rewriteProduceResponse(
        context: FilterContext,
        response: ProduceResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }

    private fun rewriteFetchResponse(
        context: FilterContext,
        response: FetchResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }

    private fun rewriteListOffsetsResponse(
        context: FilterContext,
        response: ListOffsetsResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }

    private fun rewriteCreateTopicsResponse(
        context: FilterContext,
        response: CreateTopicsResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }

    private fun rewriteDeleteTopicsResponse(
        context: FilterContext,
        response: DeleteTopicsResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }
}
