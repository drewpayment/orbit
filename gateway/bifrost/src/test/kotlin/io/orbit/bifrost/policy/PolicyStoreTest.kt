// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/policy/PolicyStoreTest.kt
package io.orbit.bifrost.policy

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class PolicyStoreTest {
    private lateinit var store: PolicyStore

    @BeforeEach
    fun setup() {
        store = PolicyStore()
    }

    @Test
    fun `upsert and get policy by id`() {
        val policy = PolicyConfig(
            id = "policy-1",
            environment = "dev",
            maxPartitions = 50,
            minPartitions = 1,
            maxRetentionMs = 604800000,
            minReplicationFactor = 1,
            allowedCleanupPolicies = listOf("delete", "compact"),
            namingPattern = "^[a-z][a-z0-9-]*$",
            maxNameLength = 255
        )

        store.upsert(policy)
        val retrieved = store.getById("policy-1")

        assertNotNull(retrieved)
        assertEquals("dev", retrieved.environment)
        assertEquals(50, retrieved.maxPartitions)
    }

    @Test
    fun `get policies by environment`() {
        val devPolicy = PolicyConfig(
            id = "policy-dev",
            environment = "dev",
            maxPartitions = 100
        )
        val prodPolicy = PolicyConfig(
            id = "policy-prod",
            environment = "prod",
            maxPartitions = 50
        )

        store.upsert(devPolicy)
        store.upsert(prodPolicy)

        val devPolicies = store.getByEnvironment("dev")
        assertEquals(1, devPolicies.size)
        assertEquals("policy-dev", devPolicies[0].id)
    }

    @Test
    fun `delete policy`() {
        val policy = PolicyConfig(id = "to-delete", environment = "dev")
        store.upsert(policy)

        store.delete("to-delete")

        assertNull(store.getById("to-delete"))
    }

    @Test
    fun `get all policies`() {
        store.upsert(PolicyConfig(id = "p1", environment = "dev"))
        store.upsert(PolicyConfig(id = "p2", environment = "prod"))

        val all = store.getAll()
        assertEquals(2, all.size)
    }

    @Test
    fun `upsert updates existing policy`() {
        val original = PolicyConfig(id = "policy-1", environment = "dev", maxPartitions = 10)
        store.upsert(original)

        val updated = PolicyConfig(id = "policy-1", environment = "dev", maxPartitions = 20)
        store.upsert(updated)

        val retrieved = store.getById("policy-1")
        assertNotNull(retrieved)
        assertEquals(20, retrieved.maxPartitions)
        assertEquals(1, store.count())
    }

    @Test
    fun `upsert handles environment change`() {
        val original = PolicyConfig(id = "policy-1", environment = "dev", maxPartitions = 10)
        store.upsert(original)

        val updated = PolicyConfig(id = "policy-1", environment = "prod", maxPartitions = 10)
        store.upsert(updated)

        assertEquals(0, store.getByEnvironment("dev").size)
        assertEquals(1, store.getByEnvironment("prod").size)
    }

    @Test
    fun `clear removes all policies`() {
        store.upsert(PolicyConfig(id = "p1", environment = "dev"))
        store.upsert(PolicyConfig(id = "p2", environment = "prod"))

        store.clear()

        assertEquals(0, store.count())
        assertNull(store.getById("p1"))
    }

    @Test
    fun `count returns correct number`() {
        assertEquals(0, store.count())

        store.upsert(PolicyConfig(id = "p1", environment = "dev"))
        assertEquals(1, store.count())

        store.upsert(PolicyConfig(id = "p2", environment = "prod"))
        assertEquals(2, store.count())
    }

    @Test
    fun `delete nonexistent policy does nothing`() {
        store.upsert(PolicyConfig(id = "p1", environment = "dev"))
        store.delete("nonexistent")

        assertEquals(1, store.count())
    }

    @Test
    fun `getByEnvironment returns empty list for unknown environment`() {
        val result = store.getByEnvironment("unknown")
        assertEquals(0, result.size)
    }
}
