package io.orbit.bifrost.callback

import java.time.Instant

/**
 * Represents a single client activity record to be reported to Orbit.
 *
 * @property virtualClusterId The virtual cluster ID this activity belongs to
 * @property serviceAccountId The service account performing the activity
 * @property topicVirtualName The topic name as seen by the client (without prefix)
 * @property direction Either "produce" or "consume"
 * @property consumerGroupId Consumer group ID (for consume activity only)
 * @property bytes Total bytes transferred in this window
 * @property messageCount Total messages transferred in this window
 * @property windowStart Start of the measurement window
 * @property windowEnd End of the measurement window
 */
data class ActivityRecord(
    val virtualClusterId: String,
    val serviceAccountId: String,
    val topicVirtualName: String,
    val direction: String,  // "produce" or "consume"
    val consumerGroupId: String? = null,
    val bytes: Long,
    val messageCount: Long,
    val windowStart: Instant,
    val windowEnd: Instant
)
