package io.orbit.bifrost.metrics

import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue

class MetricsCollectorTest {
    private lateinit var registry: PrometheusMeterRegistry
    private lateinit var collector: MetricsCollector

    @BeforeEach
    fun setup() {
        registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
        collector = MetricsCollector(registry)
    }

    @Test
    fun `recordBytesProduced increments counter with correct labels`() {
        collector.recordBytesProduced(
            virtualCluster = "test-vc",
            topic = "test-topic",
            serviceAccount = "test-sa",
            bytes = 1024
        )

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_bytes_total"))
        assertTrue(scraped.contains("virtual_cluster=\"test-vc\""))
        assertTrue(scraped.contains("direction=\"produce\""))
    }

    @Test
    fun `recordBytesConsumed increments counter with correct labels`() {
        collector.recordBytesConsumed(
            virtualCluster = "test-vc",
            topic = "test-topic",
            serviceAccount = "test-sa",
            bytes = 2048
        )

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_bytes_total"))
        assertTrue(scraped.contains("direction=\"consume\""))
    }

    @Test
    fun `recordMessagesProduced increments message counter`() {
        collector.recordMessagesProduced(
            virtualCluster = "test-vc",
            topic = "test-topic",
            serviceAccount = "test-sa",
            count = 10
        )

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_messages_total"))
    }

    @Test
    fun `recordRequest increments request counter and records latency`() {
        collector.recordRequest(
            virtualCluster = "test-vc",
            operation = "Produce",
            durationMs = 50.0
        )

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_requests_total"))
        assertTrue(scraped.contains("bifrost_request_latency_seconds"))
    }

    @Test
    fun `recordMessagesConsumed increments message counter with consume direction`() {
        collector.recordMessagesConsumed(
            virtualCluster = "test-vc",
            topic = "test-topic",
            serviceAccount = "test-sa",
            count = 5
        )

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_messages_total"))
        assertTrue(scraped.contains("direction=\"consume\""))
    }

    @Test
    fun `incrementActiveConnections increases gauge value`() {
        collector.incrementActiveConnections("test-vc")
        collector.incrementActiveConnections("test-vc")

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_active_connections"))
    }

    @Test
    fun `decrementActiveConnections decreases gauge value`() {
        collector.incrementActiveConnections("test-vc")
        collector.incrementActiveConnections("test-vc")
        collector.decrementActiveConnections("test-vc")

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_active_connections"))
    }
}
