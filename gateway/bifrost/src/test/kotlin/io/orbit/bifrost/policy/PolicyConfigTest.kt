// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/policy/PolicyConfigTest.kt
package io.orbit.bifrost.policy

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PolicyConfigTest {

    private val defaultPolicy = PolicyConfig(
        id = "test-policy",
        environment = "dev",
        maxPartitions = 50,
        minPartitions = 1,
        maxRetentionMs = 604800000, // 7 days
        minReplicationFactor = 2,
        allowedCleanupPolicies = listOf("delete", "compact"),
        namingPattern = "^[a-z][a-z0-9-]*$",
        maxNameLength = 100
    )

    @Test
    fun `valid topic passes all checks`() {
        val violations = defaultPolicy.validate(
            topicName = "my-topic-name",
            partitions = 10,
            replicationFactor = 3,
            retentionMs = 86400000,
            cleanupPolicy = "delete"
        )

        assertTrue(violations.isEmpty())
    }

    @Test
    fun `topic name exceeding max length fails`() {
        val longName = "a".repeat(101)
        val violations = defaultPolicy.validate(
            topicName = longName,
            partitions = 1,
            replicationFactor = 2
        )

        assertEquals(1, violations.size)
        assertEquals("name", violations[0].field)
        assertEquals("max_name_length", violations[0].constraint)
    }

    @Test
    fun `topic name not matching pattern fails`() {
        val violations = defaultPolicy.validate(
            topicName = "Invalid_Topic_Name",
            partitions = 1,
            replicationFactor = 2
        )

        assertEquals(1, violations.size)
        assertEquals("name", violations[0].field)
        assertEquals("naming_pattern", violations[0].constraint)
    }

    @Test
    fun `topic name starting with number fails`() {
        val violations = defaultPolicy.validate(
            topicName = "123-topic",
            partitions = 1,
            replicationFactor = 2
        )

        assertEquals(1, violations.size)
        assertEquals("naming_pattern", violations[0].constraint)
    }

    @Test
    fun `partitions exceeding max fails`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 100,
            replicationFactor = 2
        )

        assertEquals(1, violations.size)
        assertEquals("partitions", violations[0].field)
        assertEquals("max_partitions", violations[0].constraint)
    }

    @Test
    fun `partitions below min fails`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 0,
            replicationFactor = 2
        )

        assertEquals(1, violations.size)
        assertEquals("partitions", violations[0].field)
        assertEquals("min_partitions", violations[0].constraint)
    }

    @Test
    fun `replication factor below min fails`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 1,
            replicationFactor = 1
        )

        assertEquals(1, violations.size)
        assertEquals("replication_factor", violations[0].field)
        assertEquals("min_replication_factor", violations[0].constraint)
    }

    @Test
    fun `retention exceeding max fails`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 1,
            replicationFactor = 2,
            retentionMs = 604800001 // 1ms over max
        )

        assertEquals(1, violations.size)
        assertEquals("retention.ms", violations[0].field)
        assertEquals("max_retention_ms", violations[0].constraint)
    }

    @Test
    fun `null retention is allowed`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 1,
            replicationFactor = 2,
            retentionMs = null
        )

        assertTrue(violations.isEmpty())
    }

    @Test
    fun `disallowed cleanup policy fails`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 1,
            replicationFactor = 2,
            cleanupPolicy = "invalid-policy"
        )

        assertEquals(1, violations.size)
        assertEquals("cleanup.policy", violations[0].field)
        assertEquals("allowed_cleanup_policies", violations[0].constraint)
    }

    @Test
    fun `null cleanup policy is allowed`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 1,
            replicationFactor = 2,
            cleanupPolicy = null
        )

        assertTrue(violations.isEmpty())
    }

    @Test
    fun `multiple violations are returned`() {
        val violations = defaultPolicy.validate(
            topicName = "INVALID",
            partitions = 100,
            replicationFactor = 1,
            retentionMs = 999999999999,
            cleanupPolicy = "bad"
        )

        assertEquals(5, violations.size)
        assertTrue(violations.any { it.constraint == "naming_pattern" })
        assertTrue(violations.any { it.constraint == "max_partitions" })
        assertTrue(violations.any { it.constraint == "min_replication_factor" })
        assertTrue(violations.any { it.constraint == "max_retention_ms" })
        assertTrue(violations.any { it.constraint == "allowed_cleanup_policies" })
    }

    @Test
    fun `default policy values are sensible`() {
        val policy = PolicyConfig(id = "default", environment = "test")

        assertEquals(100, policy.maxPartitions)
        assertEquals(1, policy.minPartitions)
        assertEquals(2592000000, policy.maxRetentionMs) // 30 days
        assertEquals(1, policy.minReplicationFactor)
        assertEquals(listOf("delete", "compact"), policy.allowedCleanupPolicies)
        assertEquals("^[a-z][a-z0-9-]*$", policy.namingPattern)
        assertEquals(255, policy.maxNameLength)
    }

    @Test
    fun `compact cleanup policy is allowed`() {
        val violations = defaultPolicy.validate(
            topicName = "valid-topic",
            partitions = 1,
            replicationFactor = 2,
            cleanupPolicy = "compact"
        )

        assertTrue(violations.isEmpty())
    }
}
