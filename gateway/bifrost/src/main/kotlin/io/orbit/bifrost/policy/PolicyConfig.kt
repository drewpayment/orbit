// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/policy/PolicyConfig.kt
package io.orbit.bifrost.policy

/**
 * Policy configuration for topic creation validation.
 * Policies are synced from the Orbit control plane and enforce
 * constraints on topic naming, partitions, replication, and retention.
 */
data class PolicyConfig(
    val id: String,
    val environment: String,
    val maxPartitions: Int = 100,
    val minPartitions: Int = 1,
    val maxRetentionMs: Long = 2592000000, // 30 days
    val minReplicationFactor: Int = 1,
    val allowedCleanupPolicies: List<String> = listOf("delete", "compact"),
    val namingPattern: String = "^[a-z][a-z0-9-]*$",
    val maxNameLength: Int = 255
) {
    // Pre-compiled regex for performance (avoid recompilation on every validate() call)
    private val namingRegex: Regex by lazy { Regex(namingPattern) }

    /**
     * Validates a topic creation request against this policy.
     * Returns list of violations (empty if valid).
     */
    fun validate(
        topicName: String,
        partitions: Int,
        replicationFactor: Int,
        retentionMs: Long? = null,
        cleanupPolicy: String? = null
    ): List<PolicyViolation> {
        val violations = mutableListOf<PolicyViolation>()

        // Name length
        if (topicName.length > maxNameLength) {
            violations.add(PolicyViolation(
                field = "name",
                constraint = "max_name_length",
                message = "Topic name exceeds maximum length of $maxNameLength",
                actualValue = topicName.length.toString(),
                allowedValue = maxNameLength.toString()
            ))
        }

        // Name pattern (uses pre-compiled regex)
        if (!namingRegex.matches(topicName)) {
            violations.add(PolicyViolation(
                field = "name",
                constraint = "naming_pattern",
                message = "Topic name does not match required pattern: $namingPattern",
                actualValue = topicName,
                allowedValue = namingPattern
            ))
        }

        // Partitions
        if (partitions > maxPartitions) {
            violations.add(PolicyViolation(
                field = "partitions",
                constraint = "max_partitions",
                message = "Partition count $partitions exceeds maximum $maxPartitions",
                actualValue = partitions.toString(),
                allowedValue = maxPartitions.toString()
            ))
        }
        if (partitions < minPartitions) {
            violations.add(PolicyViolation(
                field = "partitions",
                constraint = "min_partitions",
                message = "Partition count $partitions below minimum $minPartitions",
                actualValue = partitions.toString(),
                allowedValue = minPartitions.toString()
            ))
        }

        // Replication factor
        if (replicationFactor < minReplicationFactor) {
            violations.add(PolicyViolation(
                field = "replication_factor",
                constraint = "min_replication_factor",
                message = "Replication factor $replicationFactor below minimum $minReplicationFactor",
                actualValue = replicationFactor.toString(),
                allowedValue = minReplicationFactor.toString()
            ))
        }

        // Retention
        if (retentionMs != null && retentionMs > maxRetentionMs) {
            violations.add(PolicyViolation(
                field = "retention.ms",
                constraint = "max_retention_ms",
                message = "Retention $retentionMs ms exceeds maximum $maxRetentionMs ms",
                actualValue = retentionMs.toString(),
                allowedValue = maxRetentionMs.toString()
            ))
        }

        // Cleanup policy
        if (cleanupPolicy != null && cleanupPolicy !in allowedCleanupPolicies) {
            violations.add(PolicyViolation(
                field = "cleanup.policy",
                constraint = "allowed_cleanup_policies",
                message = "Cleanup policy '$cleanupPolicy' not allowed. Allowed: $allowedCleanupPolicies",
                actualValue = cleanupPolicy,
                allowedValue = allowedCleanupPolicies.joinToString(", ")
            ))
        }

        return violations
    }
}

/**
 * Represents a policy violation when validating topic creation requests.
 */
data class PolicyViolation(
    val field: String,
    val constraint: String,
    val message: String,
    val actualValue: String,
    val allowedValue: String
)
