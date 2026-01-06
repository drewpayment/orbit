// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/GroupRewriteFilterTest.kt
package io.orbit.bifrost.filter

import io.orbit.bifrost.proto.VirtualClusterConfig
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class GroupRewriteFilterTest {

    private val filter = GroupRewriteFilter()

    @Test
    fun `should have correct filter order after topic filter`() {
        assertEquals(20, filter.order)
        assertTrue(filter.order > TopicRewriteFilter().order)
    }

    @Test
    fun `should have correct name`() {
        assertEquals("GroupRewriteFilter", filter.name)
    }
}
