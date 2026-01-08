// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImplTest.kt
package io.orbit.bifrost.admin

import com.google.protobuf.Timestamp
import idp.gateway.v1.Gateway
import io.orbit.bifrost.acl.ACLEntry
import io.orbit.bifrost.acl.ACLStore
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.policy.PolicyConfig
import io.orbit.bifrost.policy.PolicyStore
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BifrostAdminServiceImplTest {
    private lateinit var virtualClusterStore: VirtualClusterStore
    private lateinit var credentialStore: CredentialStore
    private lateinit var policyStore: PolicyStore
    private lateinit var aclStore: ACLStore
    private lateinit var service: BifrostAdminServiceImpl

    @BeforeEach
    fun setup() {
        virtualClusterStore = VirtualClusterStore()
        credentialStore = CredentialStore()
        policyStore = PolicyStore()
        aclStore = ACLStore()
        service = BifrostAdminServiceImpl(virtualClusterStore, credentialStore, policyStore, aclStore)
    }

    // ========================================================================
    // Policy Management Tests
    // ========================================================================

    @Test
    fun `upsertPolicy stores policy`() = runBlocking {
        val request = Gateway.UpsertPolicyRequest.newBuilder()
            .setConfig(
                Gateway.PolicyConfig.newBuilder()
                    .setId("policy-1")
                    .setEnvironment("dev")
                    .setMaxPartitions(50)
                    .setMinPartitions(1)
                    .setMaxRetentionMs(604800000)
                    .setMinReplicationFactor(1)
                    .addAllAllowedCleanupPolicies(listOf("delete", "compact"))
                    .setNamingPattern("^[a-z][a-z0-9-]*$")
                    .setMaxNameLength(255)
                    .build()
            )
            .build()

        val response = service.upsertPolicy(request)

        assertTrue(response.success)
        val stored = policyStore.getById("policy-1")
        assertNotNull(stored)
        assertEquals("dev", stored.environment)
        assertEquals(50, stored.maxPartitions)
        assertEquals(1, stored.minPartitions)
        assertEquals(604800000L, stored.maxRetentionMs)
        assertEquals(1, stored.minReplicationFactor)
        assertEquals(listOf("delete", "compact"), stored.allowedCleanupPolicies)
        assertEquals("^[a-z][a-z0-9-]*$", stored.namingPattern)
        assertEquals(255, stored.maxNameLength)
    }

    @Test
    fun `deletePolicy removes policy`() = runBlocking {
        // First, add a policy directly to the store
        val policy = PolicyConfig(
            id = "policy-to-delete",
            environment = "dev",
            maxPartitions = 100
        )
        policyStore.upsert(policy)

        // Verify it exists
        assertNotNull(policyStore.getById("policy-to-delete"))

        // Delete via service
        val request = Gateway.DeletePolicyRequest.newBuilder()
            .setPolicyId("policy-to-delete")
            .build()
        val response = service.deletePolicy(request)

        assertTrue(response.success)
        assertNull(policyStore.getById("policy-to-delete"))
    }

    @Test
    fun `listPolicies returns all policies`() = runBlocking {
        // Add multiple policies
        policyStore.upsert(PolicyConfig(id = "policy-1", environment = "dev"))
        policyStore.upsert(PolicyConfig(id = "policy-2", environment = "staging"))
        policyStore.upsert(PolicyConfig(id = "policy-3", environment = "prod"))

        val request = Gateway.ListPoliciesRequest.newBuilder().build()
        val response = service.listPolicies(request)

        assertEquals(3, response.policiesCount)
    }

    @Test
    fun `listPolicies filters by environment`() = runBlocking {
        // Add policies for different environments
        policyStore.upsert(PolicyConfig(id = "dev-policy-1", environment = "dev"))
        policyStore.upsert(PolicyConfig(id = "dev-policy-2", environment = "dev"))
        policyStore.upsert(PolicyConfig(id = "staging-policy", environment = "staging"))
        policyStore.upsert(PolicyConfig(id = "prod-policy", environment = "prod"))

        val request = Gateway.ListPoliciesRequest.newBuilder()
            .setEnvironment("dev")
            .build()
        val response = service.listPolicies(request)

        assertEquals(2, response.policiesCount)
        assertTrue(response.policiesList.all { it.environment == "dev" })
    }

    @Test
    fun `getFullConfig includes policies`() = runBlocking {
        // Add some data to each store
        virtualClusterStore.upsert(
            Gateway.VirtualClusterConfig.newBuilder()
                .setId("vc-1")
                .setApplicationSlug("test-cluster")
                .build()
        )
        policyStore.upsert(PolicyConfig(id = "policy-1", environment = "dev"))
        policyStore.upsert(PolicyConfig(id = "policy-2", environment = "prod"))

        val request = Gateway.GetFullConfigRequest.newBuilder().build()
        val response = service.getFullConfig(request)

        assertEquals(1, response.virtualClustersCount)
        assertEquals(2, response.policiesCount)
    }

    @Test
    fun `upsertPolicy updates existing policy`() = runBlocking {
        // First upsert
        val request1 = Gateway.UpsertPolicyRequest.newBuilder()
            .setConfig(
                Gateway.PolicyConfig.newBuilder()
                    .setId("policy-1")
                    .setEnvironment("dev")
                    .setMaxPartitions(10)
                    .build()
            )
            .build()
        service.upsertPolicy(request1)

        // Second upsert with same ID but different values
        val request2 = Gateway.UpsertPolicyRequest.newBuilder()
            .setConfig(
                Gateway.PolicyConfig.newBuilder()
                    .setId("policy-1")
                    .setEnvironment("dev")
                    .setMaxPartitions(20)
                    .build()
            )
            .build()
        val response = service.upsertPolicy(request2)

        assertTrue(response.success)
        val stored = policyStore.getById("policy-1")
        assertNotNull(stored)
        assertEquals(20, stored.maxPartitions)
        assertEquals(1, policyStore.count())
    }

    @Test
    fun `listPolicies returns empty list when no policies`() = runBlocking {
        val request = Gateway.ListPoliciesRequest.newBuilder().build()
        val response = service.listPolicies(request)

        assertEquals(0, response.policiesCount)
    }

    @Test
    fun `listPolicies with unknown environment returns empty list`() = runBlocking {
        policyStore.upsert(PolicyConfig(id = "policy-1", environment = "dev"))

        val request = Gateway.ListPoliciesRequest.newBuilder()
            .setEnvironment("unknown")
            .build()
        val response = service.listPolicies(request)

        assertEquals(0, response.policiesCount)
    }

    // ========================================================================
    // Topic ACL Management Tests
    // ========================================================================

    @Test
    fun `upsertTopicACL stores ACL entry`() = runBlocking {
        val expiresAt = Instant.now().plusSeconds(3600)
        val request = Gateway.UpsertTopicACLRequest.newBuilder()
            .setEntry(
                Gateway.TopicACLEntry.newBuilder()
                    .setId("share-123")
                    .setCredentialId("cred-456")
                    .setTopicPhysicalName("acme-payments-prod-orders")
                    .addAllPermissions(listOf("read", "write"))
                    .setExpiresAt(Timestamp.newBuilder()
                        .setSeconds(expiresAt.epochSecond)
                        .setNanos(expiresAt.nano)
                        .build())
                    .build()
            )
            .build()

        val response = service.upsertTopicACL(request)

        assertTrue(response.success)
        val stored = aclStore.getById("share-123")
        assertNotNull(stored)
        assertEquals("cred-456", stored.credentialId)
        assertEquals("acme-payments-prod-orders", stored.topicPhysicalName)
        assertEquals(setOf("read", "write"), stored.permissions)
        assertNotNull(stored.expiresAt)
    }

    @Test
    fun `upsertTopicACL stores entry without expiration`() = runBlocking {
        val request = Gateway.UpsertTopicACLRequest.newBuilder()
            .setEntry(
                Gateway.TopicACLEntry.newBuilder()
                    .setId("share-no-expiry")
                    .setCredentialId("cred-789")
                    .setTopicPhysicalName("acme-payments-prod-events")
                    .addAllPermissions(listOf("read"))
                    .build()
            )
            .build()

        val response = service.upsertTopicACL(request)

        assertTrue(response.success)
        val stored = aclStore.getById("share-no-expiry")
        assertNotNull(stored)
        assertNull(stored.expiresAt)
    }

    @Test
    fun `revokeTopicACL removes ACL entry`() = runBlocking {
        // First, add an ACL directly to the store
        val entry = ACLEntry(
            id = "share-to-revoke",
            credentialId = "cred-123",
            topicPhysicalName = "acme-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        aclStore.upsert(entry)

        // Verify it exists
        assertNotNull(aclStore.getById("share-to-revoke"))

        // Revoke via service
        val request = Gateway.RevokeTopicACLRequest.newBuilder()
            .setAclId("share-to-revoke")
            .build()
        val response = service.revokeTopicACL(request)

        assertTrue(response.success)
        assertNull(aclStore.getById("share-to-revoke"))
    }

    @Test
    fun `revokeTopicACL returns false for non-existent entry`() = runBlocking {
        val request = Gateway.RevokeTopicACLRequest.newBuilder()
            .setAclId("non-existent")
            .build()
        val response = service.revokeTopicACL(request)

        assertFalse(response.success)
    }

    @Test
    fun `listTopicACLs returns all entries`() = runBlocking {
        // Add multiple ACL entries
        aclStore.upsert(ACLEntry("acl-1", "cred-1", "topic-a", setOf("read"), null))
        aclStore.upsert(ACLEntry("acl-2", "cred-2", "topic-b", setOf("write"), null))
        aclStore.upsert(ACLEntry("acl-3", "cred-1", "topic-c", setOf("read", "write"), null))

        val request = Gateway.ListTopicACLsRequest.newBuilder().build()
        val response = service.listTopicACLs(request)

        assertEquals(3, response.entriesCount)
    }

    @Test
    fun `listTopicACLs filters by credentialId`() = runBlocking {
        // Add ACL entries for different credentials
        aclStore.upsert(ACLEntry("acl-1", "cred-1", "topic-a", setOf("read"), null))
        aclStore.upsert(ACLEntry("acl-2", "cred-2", "topic-b", setOf("write"), null))
        aclStore.upsert(ACLEntry("acl-3", "cred-1", "topic-c", setOf("read", "write"), null))

        val request = Gateway.ListTopicACLsRequest.newBuilder()
            .setCredentialId("cred-1")
            .build()
        val response = service.listTopicACLs(request)

        assertEquals(2, response.entriesCount)
        assertTrue(response.entriesList.all { it.credentialId == "cred-1" })
    }

    @Test
    fun `listTopicACLs returns empty list when no entries`() = runBlocking {
        val request = Gateway.ListTopicACLsRequest.newBuilder().build()
        val response = service.listTopicACLs(request)

        assertEquals(0, response.entriesCount)
    }

    @Test
    fun `getFullConfig includes topic ACLs`() = runBlocking {
        // Add some data to each store
        virtualClusterStore.upsert(
            Gateway.VirtualClusterConfig.newBuilder()
                .setId("vc-1")
                .setApplicationSlug("test-cluster")
                .build()
        )
        aclStore.upsert(ACLEntry("acl-1", "cred-1", "topic-a", setOf("read"), null))
        aclStore.upsert(ACLEntry("acl-2", "cred-2", "topic-b", setOf("write"), null))

        val request = Gateway.GetFullConfigRequest.newBuilder().build()
        val response = service.getFullConfig(request)

        assertEquals(1, response.virtualClustersCount)
        assertEquals(2, response.topicAclsCount)
    }

    @Test
    fun `upsertTopicACL updates existing entry`() = runBlocking {
        // First upsert
        val request1 = Gateway.UpsertTopicACLRequest.newBuilder()
            .setEntry(
                Gateway.TopicACLEntry.newBuilder()
                    .setId("share-update")
                    .setCredentialId("cred-1")
                    .setTopicPhysicalName("topic-original")
                    .addAllPermissions(listOf("read"))
                    .build()
            )
            .build()
        service.upsertTopicACL(request1)

        // Second upsert with same ID but different values
        val request2 = Gateway.UpsertTopicACLRequest.newBuilder()
            .setEntry(
                Gateway.TopicACLEntry.newBuilder()
                    .setId("share-update")
                    .setCredentialId("cred-1")
                    .setTopicPhysicalName("topic-updated")
                    .addAllPermissions(listOf("read", "write"))
                    .build()
            )
            .build()
        val response = service.upsertTopicACL(request2)

        assertTrue(response.success)
        val stored = aclStore.getById("share-update")
        assertNotNull(stored)
        assertEquals("topic-updated", stored.topicPhysicalName)
        assertEquals(setOf("read", "write"), stored.permissions)
        assertEquals(1, aclStore.count())
    }
}
