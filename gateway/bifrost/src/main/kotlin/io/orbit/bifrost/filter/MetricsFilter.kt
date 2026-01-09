// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/MetricsFilter.kt
package io.orbit.bifrost.filter

import io.orbit.bifrost.metrics.MetricsCollector
import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse
import org.apache.kafka.common.requests.FetchResponse
import org.apache.kafka.common.requests.ProduceRequest
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}

/**
 * MetricsFilter instruments Kafka protocol requests and responses for observability.
 *
 * This filter runs late in the chain (order 900) to capture timing after all other
 * filters have processed the request. It records:
 * - Request counts and latency per virtual cluster and operation type
 * - Bytes and messages produced (from PRODUCE requests)
 * - Bytes and messages consumed (from FETCH responses)
 *
 * Thread Safety: Uses ConcurrentHashMap for request timing tracking.
 */
class MetricsFilter(private val metricsCollector: MetricsCollector) : BifrostFilter {
    override val name = "MetricsFilter"
    override val order = 900  // Run late in the chain, after other filters

    /**
     * Tracks request start times for latency calculation.
     * Key is a unique identifier combining virtual cluster + correlation info.
     */
    private val requestStartTimes = ConcurrentHashMap<String, Long>()

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        val virtualCluster = context.virtualCluster?.id ?: "unknown"
        val operation = getOperationName(apiKey)
        val requestKey = generateRequestKey(context, apiKey)

        // Record request start time for latency calculation
        requestStartTimes[requestKey] = System.nanoTime()

        logger.debug { "Recording request start for $operation on virtual cluster $virtualCluster" }

        // For PRODUCE requests, extract and record produce metrics
        if (apiKey.toInt() == ApiKeys.PRODUCE.id.toInt() && request is ProduceRequest) {
            recordProduceMetrics(context, request)
        }

        return FilterResult.Pass(request)
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        val virtualCluster = context.virtualCluster?.id ?: "unknown"
        val operation = getOperationName(apiKey)
        val requestKey = generateRequestKey(context, apiKey)

        // Calculate latency from request start time
        val startTime = requestStartTimes.remove(requestKey)
        if (startTime != null) {
            val durationMs = (System.nanoTime() - startTime) / 1_000_000.0
            metricsCollector.recordRequest(virtualCluster, operation, durationMs)
            logger.debug { "Recorded request latency for $operation: ${durationMs}ms" }
        }

        // For FETCH responses, extract and record consume metrics
        if (apiKey.toInt() == ApiKeys.FETCH.id.toInt() && response is FetchResponse) {
            recordFetchMetrics(context, response)
        }

        return FilterResult.Pass(response)
    }

    /**
     * Records metrics for produce requests.
     * Extracts bytes and message counts from the ProduceRequest.
     */
    private fun recordProduceMetrics(context: FilterContext, request: ProduceRequest) {
        val virtualCluster = context.virtualCluster?.id ?: "unknown"
        val serviceAccount = context.credentialId ?: "unknown"

        try {
            for (topicData in request.data().topicData()) {
                val topic = topicData.name()
                var topicBytes = 0L
                var topicMessages = 0L

                for (partitionData in topicData.partitionData()) {
                    val records = partitionData.records()
                    if (records != null) {
                        topicBytes += records.sizeInBytes()
                        // Count records if possible
                        topicMessages += countRecords(records)
                    }
                }

                if (topicBytes > 0) {
                    metricsCollector.recordBytesProduced(virtualCluster, topic, serviceAccount, topicBytes)
                    logger.debug { "Recorded produce bytes: $topicBytes for topic $topic" }
                }
                if (topicMessages > 0) {
                    metricsCollector.recordMessagesProduced(virtualCluster, topic, serviceAccount, topicMessages)
                    logger.debug { "Recorded produce messages: $topicMessages for topic $topic" }
                }
            }
        } catch (e: Exception) {
            logger.warn(e) { "Failed to extract produce metrics" }
        }
    }

    /**
     * Records metrics for fetch responses.
     * Extracts bytes and message counts from the FetchResponse.
     */
    private fun recordFetchMetrics(context: FilterContext, response: FetchResponse) {
        val virtualCluster = context.virtualCluster?.id ?: "unknown"
        val serviceAccount = context.credentialId ?: "unknown"

        try {
            for (topicResponse in response.data().responses()) {
                val topic = topicResponse.topic()
                var topicBytes = 0L
                var topicMessages = 0L

                for (partitionResponse in topicResponse.partitions()) {
                    val records = partitionResponse.records()
                    if (records != null) {
                        topicBytes += records.sizeInBytes()
                        topicMessages += countRecords(records)
                    }
                }

                if (topicBytes > 0) {
                    metricsCollector.recordBytesConsumed(virtualCluster, topic, serviceAccount, topicBytes)
                    logger.debug { "Recorded consume bytes: $topicBytes for topic $topic" }
                }
                if (topicMessages > 0) {
                    metricsCollector.recordMessagesConsumed(virtualCluster, topic, serviceAccount, topicMessages)
                    logger.debug { "Recorded consume messages: $topicMessages for topic $topic" }
                }
            }
        } catch (e: Exception) {
            logger.warn(e) { "Failed to extract fetch metrics" }
        }
    }

    /**
     * Counts records in a record batch.
     * Returns an estimate based on batch structure.
     */
    private fun countRecords(records: org.apache.kafka.common.record.BaseRecords): Long {
        return when (records) {
            is org.apache.kafka.common.record.MemoryRecords -> {
                var count = 0L
                for (batch in records.batches()) {
                    // Use batch's record count if available, otherwise estimate
                    val batchCount = batch.countOrNull() ?: 1
                    count += batchCount
                }
                count
            }
            else -> 1L // Default to 1 if we can't determine count
        }
    }

    /**
     * Maps Kafka API keys to human-readable operation names.
     */
    private fun getOperationName(apiKey: Short): String {
        return when (apiKey.toInt()) {
            ApiKeys.PRODUCE.id.toInt() -> "Produce"
            ApiKeys.FETCH.id.toInt() -> "Fetch"
            ApiKeys.LIST_OFFSETS.id.toInt() -> "ListOffsets"
            ApiKeys.METADATA.id.toInt() -> "Metadata"
            ApiKeys.OFFSET_COMMIT.id.toInt() -> "OffsetCommit"
            ApiKeys.OFFSET_FETCH.id.toInt() -> "OffsetFetch"
            ApiKeys.FIND_COORDINATOR.id.toInt() -> "FindCoordinator"
            ApiKeys.JOIN_GROUP.id.toInt() -> "JoinGroup"
            ApiKeys.HEARTBEAT.id.toInt() -> "Heartbeat"
            ApiKeys.LEAVE_GROUP.id.toInt() -> "LeaveGroup"
            ApiKeys.SYNC_GROUP.id.toInt() -> "SyncGroup"
            ApiKeys.DESCRIBE_GROUPS.id.toInt() -> "DescribeGroups"
            ApiKeys.LIST_GROUPS.id.toInt() -> "ListGroups"
            ApiKeys.API_VERSIONS.id.toInt() -> "ApiVersions"
            ApiKeys.CREATE_TOPICS.id.toInt() -> "CreateTopics"
            ApiKeys.DELETE_TOPICS.id.toInt() -> "DeleteTopics"
            ApiKeys.DESCRIBE_CONFIGS.id.toInt() -> "DescribeConfigs"
            ApiKeys.ALTER_CONFIGS.id.toInt() -> "AlterConfigs"
            ApiKeys.INIT_PRODUCER_ID.id.toInt() -> "InitProducerId"
            ApiKeys.SASL_HANDSHAKE.id.toInt() -> "SaslHandshake"
            ApiKeys.SASL_AUTHENTICATE.id.toInt() -> "SaslAuthenticate"
            else -> "Unknown($apiKey)"
        }
    }

    /**
     * Generates a unique key for tracking request/response pairs.
     * Uses the Kafka protocol correlation ID which is guaranteed to match
     * between request and response, even across async/coroutine boundaries.
     */
    private fun generateRequestKey(context: FilterContext, apiKey: Short): String {
        val virtualCluster = context.virtualCluster?.id ?: "unknown"
        val correlationId = context.correlationId
        return "$virtualCluster:$apiKey:$correlationId"
    }
}
