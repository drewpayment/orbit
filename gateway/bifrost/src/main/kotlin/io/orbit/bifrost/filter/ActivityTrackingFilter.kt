package io.orbit.bifrost.filter

import io.orbit.bifrost.callback.ActivityAccumulator
import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse
import org.apache.kafka.common.requests.FetchResponse
import org.apache.kafka.common.requests.ProduceRequest

private val logger = KotlinLogging.logger {}

/**
 * ActivityTrackingFilter captures client activity for lineage reporting to Orbit.
 *
 * This filter works alongside MetricsFilter but serves a different purpose:
 * - MetricsFilter: Exports Prometheus metrics for real-time monitoring
 * - ActivityTrackingFilter: Accumulates activity for batch reporting to Orbit's lineage system
 *
 * The filter extracts virtual (unprefixed) topic names so Orbit can correlate
 * activity with the logical topics users see in the UI.
 *
 * Thread Safety: Delegates to ActivityAccumulator which is thread-safe.
 *
 * Order: Runs at 910 (after MetricsFilter at 900) to ensure we see the same
 * request/response data.
 */
class ActivityTrackingFilter(
    private val accumulator: ActivityAccumulator
) : BifrostFilter {
    override val name = "ActivityTrackingFilter"
    override val order = 910  // Run after MetricsFilter

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        // Track produce requests
        if (apiKey.toInt() == ApiKeys.PRODUCE.id.toInt() && request is ProduceRequest) {
            trackProduceRequest(context, request)
        }

        return FilterResult.Pass(request)
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        // Track fetch responses (consume activity)
        if (apiKey.toInt() == ApiKeys.FETCH.id.toInt() && response is FetchResponse) {
            trackFetchResponse(context, response)
        }

        return FilterResult.Pass(response)
    }

    /**
     * Tracks produce activity from a ProduceRequest.
     */
    private fun trackProduceRequest(context: FilterContext, request: ProduceRequest) {
        val virtualCluster = context.virtualCluster ?: return
        val serviceAccountId = context.credentialId ?: return

        try {
            for (topicData in request.data().topicData()) {
                val physicalTopic = topicData.name()
                // Strip the topic prefix to get the virtual name
                val virtualTopic = stripTopicPrefix(physicalTopic, context.topicPrefix)

                var topicBytes = 0L
                var topicMessages = 0L

                for (partitionData in topicData.partitionData()) {
                    val records = partitionData.records()
                    if (records != null) {
                        topicBytes += records.sizeInBytes()
                        topicMessages += countRecords(records)
                    }
                }

                if (topicBytes > 0 || topicMessages > 0) {
                    accumulator.recordProduceActivity(
                        virtualClusterId = virtualCluster.id,
                        serviceAccountId = serviceAccountId,
                        topicVirtualName = virtualTopic,
                        bytes = topicBytes,
                        messageCount = topicMessages
                    )
                }
            }
        } catch (e: Exception) {
            logger.warn(e) { "Failed to track produce activity" }
        }
    }

    /**
     * Tracks consume activity from a FetchResponse.
     */
    private fun trackFetchResponse(context: FilterContext, response: FetchResponse) {
        val virtualCluster = context.virtualCluster ?: return
        val serviceAccountId = context.credentialId ?: return

        try {
            for (topicResponse in response.data().responses()) {
                val physicalTopic = topicResponse.topic()
                // Strip the topic prefix to get the virtual name
                val virtualTopic = stripTopicPrefix(physicalTopic, context.topicPrefix)

                var topicBytes = 0L
                var topicMessages = 0L

                for (partitionResponse in topicResponse.partitions()) {
                    val records = partitionResponse.records()
                    if (records != null) {
                        topicBytes += records.sizeInBytes()
                        topicMessages += countRecords(records)
                    }
                }

                if (topicBytes > 0 || topicMessages > 0) {
                    accumulator.recordConsumeActivity(
                        virtualClusterId = virtualCluster.id,
                        serviceAccountId = serviceAccountId,
                        topicVirtualName = virtualTopic,
                        consumerGroupId = context.consumerGroupId,
                        bytes = topicBytes,
                        messageCount = topicMessages
                    )
                }
            }
        } catch (e: Exception) {
            logger.warn(e) { "Failed to track consume activity" }
        }
    }

    /**
     * Strips the topic prefix from a physical topic name to get the virtual name.
     * The prefix includes a trailing separator (e.g., "prod.myapp." -> "")
     */
    private fun stripTopicPrefix(physicalTopic: String, prefix: String): String {
        return if (prefix.isNotEmpty() && physicalTopic.startsWith(prefix)) {
            physicalTopic.removePrefix(prefix)
        } else {
            physicalTopic
        }
    }

    /**
     * Counts records in a record batch.
     */
    private fun countRecords(records: org.apache.kafka.common.record.BaseRecords): Long {
        return when (records) {
            is org.apache.kafka.common.record.MemoryRecords -> {
                var count = 0L
                for (batch in records.batches()) {
                    val batchCount = batch.countOrNull() ?: 1
                    count += batchCount
                }
                count
            }
            else -> 1L
        }
    }
}
