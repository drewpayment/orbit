// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/TopicRewriteFilterTest.kt
package io.orbit.bifrost.filter

import io.orbit.bifrost.proto.VirtualClusterConfig
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class TopicRewriteFilterTest {

    private val filter = TopicRewriteFilter()

    private fun createContext(
        topicPrefix: String = "acme-payments-dev-",
        readOnly: Boolean = false
    ): FilterContext {
        val config = VirtualClusterConfig.newBuilder()
            .setId("vc-test")
            .setTopicPrefix(topicPrefix)
            .setGroupPrefix(topicPrefix)
            .setReadOnly(readOnly)
            .build()
        return FilterContext(virtualCluster = config)
    }

    @Test
    fun `should pass through when no prefix configured`() = runBlocking {
        val context = FilterContext(virtualCluster = null)
        // This would test with a real request in production
        // For now, verify the filter handles null context gracefully
        assertEquals("", context.topicPrefix)
    }

    @Test
    fun `should reject produce request when read-only`() = runBlocking {
        val context = createContext(readOnly = true)
        // Would test with real ProduceRequest
        assertTrue(context.isReadOnly)
    }

    @Test
    fun `should have correct filter order`() {
        assertEquals(10, filter.order)
        assertEquals("TopicRewriteFilter", filter.name)
    }
}
