package io.orbit.bifrost.metrics

import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * MetricsCollector provides Prometheus-compatible metrics for the Bifrost Kafka Gateway.
 *
 * Thread Safety: All operations are thread-safe. Meters are cached to avoid re-registration.
 */
class MetricsCollector(private val registry: MeterRegistry) {

    private val counters = ConcurrentHashMap<String, Counter>()
    private val timers = ConcurrentHashMap<String, Timer>()
    private val activeConnections = ConcurrentHashMap<String, AtomicInteger>()

    fun recordBytesProduced(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        bytes: Long
    ) {
        val key = "bytes:$virtualCluster:$topic:$serviceAccount:produce"
        val counter = counters.computeIfAbsent(key) {
            Counter.builder("bifrost_bytes_total")
                .tag("virtual_cluster", virtualCluster)
                .tag("topic", topic)
                .tag("service_account", serviceAccount)
                .tag("direction", "produce")
                .register(registry)
        }
        counter.increment(bytes.toDouble())
    }

    fun recordBytesConsumed(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        bytes: Long
    ) {
        val key = "bytes:$virtualCluster:$topic:$serviceAccount:consume"
        val counter = counters.computeIfAbsent(key) {
            Counter.builder("bifrost_bytes_total")
                .tag("virtual_cluster", virtualCluster)
                .tag("topic", topic)
                .tag("service_account", serviceAccount)
                .tag("direction", "consume")
                .register(registry)
        }
        counter.increment(bytes.toDouble())
    }

    fun recordMessagesProduced(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        count: Long
    ) {
        val key = "messages:$virtualCluster:$topic:$serviceAccount:produce"
        val counter = counters.computeIfAbsent(key) {
            Counter.builder("bifrost_messages_total")
                .tag("virtual_cluster", virtualCluster)
                .tag("topic", topic)
                .tag("service_account", serviceAccount)
                .tag("direction", "produce")
                .register(registry)
        }
        counter.increment(count.toDouble())
    }

    fun recordMessagesConsumed(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        count: Long
    ) {
        val key = "messages:$virtualCluster:$topic:$serviceAccount:consume"
        val counter = counters.computeIfAbsent(key) {
            Counter.builder("bifrost_messages_total")
                .tag("virtual_cluster", virtualCluster)
                .tag("topic", topic)
                .tag("service_account", serviceAccount)
                .tag("direction", "consume")
                .register(registry)
        }
        counter.increment(count.toDouble())
    }

    fun recordRequest(
        virtualCluster: String,
        operation: String,
        durationMs: Double
    ) {
        val counterKey = "request:$virtualCluster:$operation"
        val counter = counters.computeIfAbsent(counterKey) {
            Counter.builder("bifrost_requests_total")
                .tag("virtual_cluster", virtualCluster)
                .tag("operation", operation)
                .register(registry)
        }
        counter.increment()

        val timerKey = "latency:$virtualCluster:$operation"
        val timer = timers.computeIfAbsent(timerKey) {
            Timer.builder("bifrost_request_latency_seconds")
                .tag("virtual_cluster", virtualCluster)
                .tag("operation", operation)
                .register(registry)
        }
        timer.record((durationMs * 1_000_000).toLong(), TimeUnit.NANOSECONDS)
    }

    fun incrementActiveConnections(virtualCluster: String) {
        val counter = activeConnections.computeIfAbsent(virtualCluster) { vc ->
            val atomicCounter = AtomicInteger(0)
            Gauge.builder("bifrost_active_connections", atomicCounter) { it.get().toDouble() }
                .tag("virtual_cluster", vc)
                .register(registry)
            atomicCounter
        }
        counter.incrementAndGet()
    }

    fun decrementActiveConnections(virtualCluster: String) {
        activeConnections[virtualCluster]?.let { counter ->
            if (counter.get() > 0) {
                counter.decrementAndGet()
            }
        }
    }
}
