package io.orbit.bifrost.metrics

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MetricsEndpointTest {

    @Test
    fun `metrics endpoint returns prometheus format`() = testApplication {
        val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)

        application {
            configureMetricsEndpoint(registry)
        }

        val response = client.get("/metrics")
        assertEquals(HttpStatusCode.OK, response.status)
        assertTrue(response.contentType()?.match(ContentType.Text.Plain) == true)
    }

    @Test
    fun `health endpoint returns OK`() = testApplication {
        val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)

        application {
            configureMetricsEndpoint(registry)
        }

        val response = client.get("/health")
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("OK", response.bodyAsText())
    }

    @Test
    fun `ready endpoint returns READY`() = testApplication {
        val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)

        application {
            configureMetricsEndpoint(registry)
        }

        val response = client.get("/ready")
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("READY", response.bodyAsText())
    }

    @Test
    fun `metrics endpoint includes registered metrics`() = testApplication {
        val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
        val collector = MetricsCollector(registry)

        // Record some metrics
        collector.recordMessagesProduced("test-cluster", "test-topic", "test-sa", 10)
        collector.recordBytesProduced("test-cluster", "test-topic", "test-sa", 1024)

        application {
            configureMetricsEndpoint(registry)
        }

        val response = client.get("/metrics")
        val body = response.bodyAsText()

        assertTrue(body.contains("bifrost_messages_total"), "Should contain messages metric")
        assertTrue(body.contains("bifrost_bytes_total"), "Should contain bytes metric")
    }
}
