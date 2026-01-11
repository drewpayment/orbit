package io.orbit.bifrost.callback

import mu.KotlinLogging
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

private val logger = KotlinLogging.logger {}

/**
 * Accumulates client activity metrics for batch reporting to Orbit.
 *
 * Activity is aggregated by (virtualCluster, serviceAccount, topic, direction) to reduce
 * the number of records sent to Orbit. Accumulated data is flushed periodically by
 * the ActivityEmitter.
 *
 * Thread Safety: All operations are thread-safe using ConcurrentHashMap and AtomicLong.
 */
class ActivityAccumulator {

    /**
     * Key for aggregating activity records.
     */
    private data class ActivityKey(
        val virtualClusterId: String,
        val serviceAccountId: String,
        val topicVirtualName: String,
        val direction: String,
        val consumerGroupId: String?
    )

    /**
     * Accumulated metrics for a single activity key.
     */
    private class AccumulatedMetrics {
        val bytes = AtomicLong(0)
        val messageCount = AtomicLong(0)
        @Volatile var firstSeen: Instant = Instant.now()
        @Volatile var lastSeen: Instant = Instant.now()

        fun add(newBytes: Long, newMessages: Long) {
            bytes.addAndGet(newBytes)
            messageCount.addAndGet(newMessages)
            lastSeen = Instant.now()
        }
    }

    private val activities = ConcurrentHashMap<ActivityKey, AccumulatedMetrics>()

    /**
     * Records produce activity for later reporting.
     */
    fun recordProduceActivity(
        virtualClusterId: String,
        serviceAccountId: String,
        topicVirtualName: String,
        bytes: Long,
        messageCount: Long
    ) {
        val key = ActivityKey(
            virtualClusterId = virtualClusterId,
            serviceAccountId = serviceAccountId,
            topicVirtualName = topicVirtualName,
            direction = "produce",
            consumerGroupId = null
        )

        val metrics = activities.computeIfAbsent(key) { AccumulatedMetrics() }
        metrics.add(bytes, messageCount)

        logger.trace {
            "Accumulated produce activity: vCluster=$virtualClusterId, " +
                "topic=$topicVirtualName, bytes=$bytes, messages=$messageCount"
        }
    }

    /**
     * Records consume activity for later reporting.
     */
    fun recordConsumeActivity(
        virtualClusterId: String,
        serviceAccountId: String,
        topicVirtualName: String,
        consumerGroupId: String?,
        bytes: Long,
        messageCount: Long
    ) {
        val key = ActivityKey(
            virtualClusterId = virtualClusterId,
            serviceAccountId = serviceAccountId,
            topicVirtualName = topicVirtualName,
            direction = "consume",
            consumerGroupId = consumerGroupId
        )

        val metrics = activities.computeIfAbsent(key) { AccumulatedMetrics() }
        metrics.add(bytes, messageCount)

        logger.trace {
            "Accumulated consume activity: vCluster=$virtualClusterId, " +
                "topic=$topicVirtualName, group=$consumerGroupId, bytes=$bytes, messages=$messageCount"
        }
    }

    /**
     * Flushes all accumulated activity and returns the records.
     * After calling this method, the accumulator is reset to empty.
     *
     * @return List of activity records ready for sending to Orbit
     */
    fun flush(): List<ActivityRecord> {
        val windowEnd = Instant.now()

        // Atomically swap out all activities
        val snapshot = activities.toMap()
        activities.clear()

        if (snapshot.isEmpty()) {
            return emptyList()
        }

        val records = snapshot.map { (key, metrics) ->
            ActivityRecord(
                virtualClusterId = key.virtualClusterId,
                serviceAccountId = key.serviceAccountId,
                topicVirtualName = key.topicVirtualName,
                direction = key.direction,
                consumerGroupId = key.consumerGroupId,
                bytes = metrics.bytes.get(),
                messageCount = metrics.messageCount.get(),
                windowStart = metrics.firstSeen,
                windowEnd = windowEnd
            )
        }

        logger.debug { "Flushed ${records.size} activity records" }
        return records
    }

    /**
     * Returns the current count of unique activity keys being tracked.
     */
    fun size(): Int = activities.size
}
