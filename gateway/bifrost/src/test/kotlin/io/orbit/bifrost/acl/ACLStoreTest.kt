// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/acl/ACLStoreTest.kt
package io.orbit.bifrost.acl

import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import java.time.Instant

class ACLStoreTest {
    private lateinit var store: ACLStore

    @BeforeEach
    fun setup() {
        store = ACLStore()
    }

    @Test
    fun `upsert and retrieve by credential`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)

        val results = store.getByCredential("cred-1")
        assertEquals(1, results.size)
        assertEquals("share-1", results[0].id)
    }

    @Test
    fun `upsert and retrieve by id`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read", "write"),
            expiresAt = null
        )
        store.upsert(entry)

        val retrieved = store.getById("share-1")
        assertNotNull(retrieved)
        assertEquals("cred-1", retrieved.credentialId)
        assertEquals("acme-payments-prod-orders", retrieved.topicPhysicalName)
        assertEquals(setOf("read", "write"), retrieved.permissions)
    }

    @Test
    fun `upsert and retrieve by topic`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)

        val results = store.getByTopic("acme-payments-prod-orders")
        assertEquals(1, results.size)
        assertEquals("share-1", results[0].id)
    }

    @Test
    fun `check permission for topic`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)

        assertTrue(store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
        assertFalse(store.hasPermission("cred-1", "acme-payments-prod-orders", "write"))
        assertFalse(store.hasPermission("cred-1", "other-topic", "read"))
        assertFalse(store.hasPermission("other-cred", "acme-payments-prod-orders", "read"))
    }

    @Test
    fun `expired ACL returns false for hasPermission`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = Instant.now().minusSeconds(3600) // Expired 1 hour ago
        )
        store.upsert(entry)

        assertFalse(store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
    }

    @Test
    fun `expired ACL not returned in getByCredential`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = Instant.now().minusSeconds(3600) // Expired 1 hour ago
        )
        store.upsert(entry)

        val results = store.getByCredential("cred-1")
        assertEquals(0, results.size)
    }

    @Test
    fun `expired ACL not returned in getByTopic`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = Instant.now().minusSeconds(3600) // Expired 1 hour ago
        )
        store.upsert(entry)

        val results = store.getByTopic("acme-payments-prod-orders")
        assertEquals(0, results.size)
    }

    @Test
    fun `non-expired ACL is valid`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = Instant.now().plusSeconds(3600) // Expires in 1 hour
        )
        store.upsert(entry)

        assertTrue(store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
    }

    @Test
    fun `revoke removes ACL`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)
        val revoked = store.revoke("share-1")

        assertTrue(revoked)
        assertFalse(store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
        assertEquals(0, store.getByCredential("cred-1").size)
        assertEquals(0, store.getByTopic("acme-payments-prod-orders").size)
        assertNull(store.getById("share-1"))
    }

    @Test
    fun `revoke nonexistent ACL returns false`() {
        val revoked = store.revoke("nonexistent")
        assertFalse(revoked)
    }

    @Test
    fun `upsert updates existing ACL`() {
        val original = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(original)

        val updated = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read", "write"),
            expiresAt = null
        )
        store.upsert(updated)

        assertEquals(1, store.count())
        assertTrue(store.hasPermission("cred-1", "acme-payments-prod-orders", "write"))
    }

    @Test
    fun `upsert handles credential change`() {
        val original = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(original)

        val updated = ACLEntry(
            id = "share-1",
            credentialId = "cred-2",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(updated)

        assertEquals(0, store.getByCredential("cred-1").size)
        assertEquals(1, store.getByCredential("cred-2").size)
        assertEquals(1, store.count())
    }

    @Test
    fun `upsert handles topic change`() {
        val original = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "topic-1",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(original)

        val updated = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "topic-2",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(updated)

        assertEquals(0, store.getByTopic("topic-1").size)
        assertEquals(1, store.getByTopic("topic-2").size)
        assertEquals(1, store.count())
    }

    @Test
    fun `getAll returns all entries`() {
        store.upsert(ACLEntry("share-1", "cred-1", "topic-1", setOf("read"), null))
        store.upsert(ACLEntry("share-2", "cred-2", "topic-2", setOf("write"), null))

        val all = store.getAll()
        assertEquals(2, all.size)
    }

    @Test
    fun `count returns correct number`() {
        assertEquals(0, store.count())

        store.upsert(ACLEntry("share-1", "cred-1", "topic-1", setOf("read"), null))
        assertEquals(1, store.count())

        store.upsert(ACLEntry("share-2", "cred-2", "topic-2", setOf("write"), null))
        assertEquals(2, store.count())
    }

    @Test
    fun `clear removes all entries`() {
        store.upsert(ACLEntry("share-1", "cred-1", "topic-1", setOf("read"), null))
        store.upsert(ACLEntry("share-2", "cred-2", "topic-2", setOf("write"), null))

        store.clear()

        assertEquals(0, store.count())
        assertEquals(0, store.getByCredential("cred-1").size)
        assertEquals(0, store.getByTopic("topic-1").size)
    }

    @Test
    fun `getByCredential returns empty list for unknown credential`() {
        val results = store.getByCredential("unknown")
        assertEquals(0, results.size)
    }

    @Test
    fun `getByTopic returns empty list for unknown topic`() {
        val results = store.getByTopic("unknown")
        assertEquals(0, results.size)
    }

    @Test
    fun `multiple ACLs for same credential`() {
        store.upsert(ACLEntry("share-1", "cred-1", "topic-1", setOf("read"), null))
        store.upsert(ACLEntry("share-2", "cred-1", "topic-2", setOf("write"), null))

        val results = store.getByCredential("cred-1")
        assertEquals(2, results.size)
    }

    @Test
    fun `multiple ACLs for same topic`() {
        store.upsert(ACLEntry("share-1", "cred-1", "topic-1", setOf("read"), null))
        store.upsert(ACLEntry("share-2", "cred-2", "topic-1", setOf("write"), null))

        val results = store.getByTopic("topic-1")
        assertEquals(2, results.size)
    }
}
