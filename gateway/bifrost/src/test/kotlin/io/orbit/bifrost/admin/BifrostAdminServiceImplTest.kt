// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImplTest.kt
package io.orbit.bifrost.admin

import idp.gateway.v1.Gateway
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.policy.PolicyConfig
import io.orbit.bifrost.policy.PolicyStore
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BifrostAdminServiceImplTest {
    private lateinit var virtualClusterStore: VirtualClusterStore
    private lateinit var credentialStore: CredentialStore
    private lateinit var policyStore: PolicyStore
    private lateinit var service: BifrostAdminServiceImpl

    @BeforeEach
    fun setup() {
        virtualClusterStore = VirtualClusterStore()
        credentialStore = CredentialStore()
        policyStore = PolicyStore()
        service = BifrostAdminServiceImpl(virtualClusterStore, credentialStore, policyStore)
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
                .setName("test-cluster")
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
}
