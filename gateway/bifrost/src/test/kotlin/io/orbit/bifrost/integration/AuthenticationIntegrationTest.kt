// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/integration/AuthenticationIntegrationTest.kt
package io.orbit.bifrost.integration

import io.orbit.bifrost.auth.Credential
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.auth.PermissionTemplate
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class AuthenticationIntegrationTest {

    private lateinit var store: CredentialStore

    @BeforeEach
    fun setup() {
        store = CredentialStore()
    }

    @Test
    fun `should authenticate with valid credentials`() {
        val password = "test-password-123"
        val credential = Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "test-user",
            passwordHash = CredentialStore.hashPassword(password),
            permissionTemplate = PermissionTemplate.PRODUCER
        )

        store.upsert(credential)

        val result = store.authenticate("test-user", password)
        assertNotNull(result)
        assertEquals("cred-1", result?.id)
    }

    @Test
    fun `should reject invalid password`() {
        val credential = Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "test-user",
            passwordHash = CredentialStore.hashPassword("correct-password"),
            permissionTemplate = PermissionTemplate.CONSUMER
        )

        store.upsert(credential)

        val result = store.authenticate("test-user", "wrong-password")
        assertNull(result)
    }

    @Test
    fun `should reject unknown username`() {
        val result = store.authenticate("unknown-user", "any-password")
        assertNull(result)
    }

    @Test
    fun `should revoke credential`() {
        val credential = Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "test-user",
            passwordHash = CredentialStore.hashPassword("password"),
            permissionTemplate = PermissionTemplate.ADMIN
        )

        store.upsert(credential)
        assertTrue(store.revoke("cred-1"))

        val result = store.authenticate("test-user", "password")
        assertNull(result)
    }

    @Test
    fun `should list credentials by virtual cluster`() {
        store.upsert(Credential(
            id = "cred-1",
            virtualClusterId = "vc-dev",
            username = "user-1",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.PRODUCER
        ))
        store.upsert(Credential(
            id = "cred-2",
            virtualClusterId = "vc-dev",
            username = "user-2",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.CONSUMER
        ))
        store.upsert(Credential(
            id = "cred-3",
            virtualClusterId = "vc-prod",
            username = "user-3",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.ADMIN
        ))

        val devCredentials = store.getByVirtualCluster("vc-dev")
        assertEquals(2, devCredentials.size)

        val prodCredentials = store.getByVirtualCluster("vc-prod")
        assertEquals(1, prodCredentials.size)
    }

    @Test
    fun `should update credential on upsert with same id`() {
        val credential1 = Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "user-1",
            passwordHash = CredentialStore.hashPassword("password1"),
            permissionTemplate = PermissionTemplate.CONSUMER
        )
        store.upsert(credential1)

        // Update with same id but different password
        val credential2 = Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "user-1",
            passwordHash = CredentialStore.hashPassword("password2"),
            permissionTemplate = PermissionTemplate.PRODUCER
        )
        store.upsert(credential2)

        // Old password should not work
        assertNull(store.authenticate("user-1", "password1"))
        // New password should work
        assertNotNull(store.authenticate("user-1", "password2"))
        // Template should be updated
        assertEquals(PermissionTemplate.PRODUCER, store.getById("cred-1")?.permissionTemplate)
    }

    @Test
    fun `should count credentials correctly`() {
        assertEquals(0, store.count())

        store.upsert(Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "user-1",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.CONSUMER
        ))
        assertEquals(1, store.count())

        store.upsert(Credential(
            id = "cred-2",
            virtualClusterId = "vc-1",
            username = "user-2",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.CONSUMER
        ))
        assertEquals(2, store.count())

        store.revoke("cred-1")
        assertEquals(1, store.count())
    }

    @Test
    fun `should clear all credentials`() {
        store.upsert(Credential(
            id = "cred-1",
            virtualClusterId = "vc-1",
            username = "user-1",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.CONSUMER
        ))
        store.upsert(Credential(
            id = "cred-2",
            virtualClusterId = "vc-1",
            username = "user-2",
            passwordHash = "hash",
            permissionTemplate = PermissionTemplate.PRODUCER
        ))

        assertEquals(2, store.count())
        store.clear()
        assertEquals(0, store.count())
    }
}
