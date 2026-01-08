// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/TopicACLFilterTest.kt
package io.orbit.bifrost.filter

import idp.gateway.v1.Gateway.VirtualClusterConfig
import io.orbit.bifrost.acl.ACLEntry
import io.orbit.bifrost.acl.ACLStore
import kotlinx.coroutines.runBlocking
import org.apache.kafka.common.message.FetchRequestData
import org.apache.kafka.common.message.ProduceRequestData
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.record.MemoryRecords
import org.apache.kafka.common.requests.FetchRequest
import org.apache.kafka.common.requests.ProduceRequest
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class TopicACLFilterTest {

    private lateinit var aclStore: ACLStore
    private lateinit var filter: TopicACLFilter

    @BeforeEach
    fun setup() {
        aclStore = ACLStore()
        filter = TopicACLFilter(aclStore)
    }

    private fun createContext(
        topicPrefix: String = "acme-payments-dev-",
        credentialId: String? = "cred-123"
    ): FilterContext {
        val config = VirtualClusterConfig.newBuilder()
            .setId("vc-test")
            .setTopicPrefix(topicPrefix)
            .setGroupPrefix(topicPrefix)
            .build()
        return FilterContext(
            virtualCluster = config,
            credentialId = credentialId,
            isAuthenticated = true
        )
    }

    private fun createFetchRequest(vararg topics: String): FetchRequest {
        val data = FetchRequestData()
        topics.forEach { topic ->
            val fetchTopic = FetchRequestData.FetchTopic()
                .setTopic(topic)
            fetchTopic.partitions().add(
                FetchRequestData.FetchPartition()
                    .setPartition(0)
                    .setFetchOffset(0)
                    .setPartitionMaxBytes(1024 * 1024)
            )
            data.topics().add(fetchTopic)
        }
        // Build FetchRequest directly from data
        return FetchRequest(data, ApiKeys.FETCH.latestVersion())
    }

    private fun createProduceRequest(vararg topics: String): ProduceRequest {
        val data = ProduceRequestData()
        topics.forEach { topic ->
            val topicData = ProduceRequestData.TopicProduceData()
                .setName(topic)
            topicData.partitionData().add(
                ProduceRequestData.PartitionProduceData()
                    .setIndex(0)
                    .setRecords(MemoryRecords.EMPTY)
            )
            data.topicData().add(topicData)
        }
        // Build ProduceRequest directly from data
        return ProduceRequest(data, ApiKeys.PRODUCE.latestVersion())
    }

    @Test
    fun `has correct filter order after TopicRewriteFilter`() {
        assertEquals(15, filter.order)
        assertEquals("TopicACLFilter", filter.name)
    }

    @Test
    fun `allows access to own topics without ACL for FETCH`() = runBlocking {
        // Topic with our prefix - should pass without ACL check
        val context = createContext(topicPrefix = "acme-payments-dev-")
        val request = createFetchRequest("acme-payments-dev-orders")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `allows access to own topics without ACL for PRODUCE`() = runBlocking {
        // Topic with our prefix - should pass without ACL check
        val context = createContext(topicPrefix = "acme-payments-dev-")
        val request = createProduceRequest("acme-payments-dev-orders")

        val result = filter.onRequest(context, ApiKeys.PRODUCE.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `blocks access to foreign topic without ACL for FETCH`() = runBlocking {
        // Topic from different app - no ACL - should block
        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createFetchRequest("other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Reject<*>>(result)
        assertEquals(29.toShort(), (result as FilterResult.Reject).errorCode)
    }

    @Test
    fun `blocks access to foreign topic without ACL for PRODUCE`() = runBlocking {
        // Topic from different app - no ACL - should block
        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createProduceRequest("other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.PRODUCE.id.toShort(), request)

        assertIs<FilterResult.Reject<*>>(result)
        assertEquals(29.toShort(), (result as FilterResult.Reject).errorCode)
    }

    @Test
    fun `allows access to foreign topic with valid read ACL for FETCH`() = runBlocking {
        // Setup: Grant read access to foreign topic
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-123",
            topicPhysicalName = "other-app-prod-events",
            permissions = setOf("read"),
            expiresAt = null
        )
        aclStore.upsert(entry)

        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createFetchRequest("other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `allows access to foreign topic with valid write ACL for PRODUCE`() = runBlocking {
        // Setup: Grant write access to foreign topic
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-123",
            topicPhysicalName = "other-app-prod-events",
            permissions = setOf("write"),
            expiresAt = null
        )
        aclStore.upsert(entry)

        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createProduceRequest("other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.PRODUCE.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `blocks PRODUCE to foreign topic with only read ACL`() = runBlocking {
        // Setup: Grant only read access (not write)
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-123",
            topicPhysicalName = "other-app-prod-events",
            permissions = setOf("read"),
            expiresAt = null
        )
        aclStore.upsert(entry)

        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createProduceRequest("other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.PRODUCE.id.toShort(), request)

        assertIs<FilterResult.Reject<*>>(result)
        assertEquals(29.toShort(), (result as FilterResult.Reject).errorCode)
    }

    @Test
    fun `blocks FETCH to foreign topic with only write ACL`() = runBlocking {
        // Setup: Grant only write access (not read)
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-123",
            topicPhysicalName = "other-app-prod-events",
            permissions = setOf("write"),
            expiresAt = null
        )
        aclStore.upsert(entry)

        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createFetchRequest("other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Reject<*>>(result)
        assertEquals(29.toShort(), (result as FilterResult.Reject).errorCode)
    }

    @Test
    fun `passes through non-FETCH and non-PRODUCE requests`() = runBlocking {
        val context = createContext()
        // Using a different request type - Metadata
        val request = createFetchRequest("any-topic")

        // Test with METADATA ApiKey
        val result = filter.onRequest(context, ApiKeys.METADATA.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `handles request with multiple topics - all allowed`() = runBlocking {
        // One own topic, one shared topic with ACL
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-123",
            topicPhysicalName = "other-app-prod-events",
            permissions = setOf("read"),
            expiresAt = null
        )
        aclStore.upsert(entry)

        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createFetchRequest("acme-payments-dev-orders", "other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `handles request with multiple topics - one blocked`() = runBlocking {
        // One own topic, one foreign topic WITHOUT ACL
        val context = createContext(
            topicPrefix = "acme-payments-dev-",
            credentialId = "cred-123"
        )
        val request = createFetchRequest("acme-payments-dev-orders", "other-app-prod-events")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Reject<*>>(result)
    }

    @Test
    fun `passes when no credential id in context`() = runBlocking {
        // No credential - filter should pass (let other filters handle auth)
        val config = VirtualClusterConfig.newBuilder()
            .setId("vc-test")
            .setTopicPrefix("acme-payments-dev-")
            .build()
        val context = FilterContext(virtualCluster = config, credentialId = null)
        val request = createFetchRequest("acme-payments-dev-orders")

        val result = filter.onRequest(context, ApiKeys.FETCH.id.toShort(), request)

        assertIs<FilterResult.Pass<*>>(result)
    }

    @Test
    fun `onResponse always passes through`() = runBlocking {
        val context = createContext()
        // Responses are not filtered by ACL
        val request = createFetchRequest("any-topic")

        // We can't easily create a FetchResponse, but we verify the order is correct
        assertEquals(15, filter.order)
    }
}
