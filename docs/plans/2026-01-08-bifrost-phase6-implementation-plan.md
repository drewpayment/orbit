# Bifrost Phase 6: Metrics & Chargeback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement usage tracking and chargeback visibility for Bifrost Kafka Gateway, enabling workspace teams to see consumption metrics and platform admins to export billing data.

**Architecture:** Prometheus scrapes metrics from Bifrost gateway, Temporal workflow aggregates to hourly buckets stored in Payload CMS, TypeScript service calculates chargeback from stored metrics, React dashboards display usage and costs.

**Tech Stack:** Prometheus, Micrometer (Kotlin), Temporal Go workflows, Payload CMS collections, React/TypeScript components with recharts

**Worktree:** `/Users/drew.payment/dev/orbit/.worktrees/bifrost-phase6-metrics-chargeback`

**Design Doc:** `docs/plans/2026-01-08-bifrost-phase6-metrics-chargeback-design.md`

---

## Phase 6.1: Prometheus Infrastructure

### Task 1: Add Prometheus to Docker Compose

**Files:**
- Modify: `docker-compose.yml`
- Create: `infrastructure/prometheus/prometheus.yml`

**Step 1: Create Prometheus config directory**

```bash
mkdir -p infrastructure/prometheus
```

**Step 2: Create Prometheus scrape configuration**

Create file `infrastructure/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'bifrost-dev'
    static_configs:
      - targets: ['bifrost-dev:9093']
    metrics_path: /metrics

  - job_name: 'bifrost-stage'
    static_configs:
      - targets: ['bifrost-stage:9093']
    metrics_path: /metrics

  - job_name: 'bifrost-prod'
    static_configs:
      - targets: ['bifrost-prod:9093']
    metrics_path: /metrics
```

**Step 3: Add Prometheus service to docker-compose.yml**

Add to services section:

```yaml
  prometheus:
    image: prom/prometheus:v2.47.0
    container_name: orbit-prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./infrastructure/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
    networks:
      - orbit-network
    restart: unless-stopped
```

Add to volumes section:

```yaml
  prometheus-data:
```

**Step 4: Verify docker-compose is valid**

Run: `docker-compose config --quiet && echo "Valid"`

Expected: `Valid`

**Step 5: Commit**

```bash
git add infrastructure/prometheus docker-compose.yml
git commit -m "feat(infra): add Prometheus for Bifrost metrics collection"
```

---

## Phase 6.2: Bifrost Metrics Instrumentation

### Task 2: Add Micrometer Dependency

**Files:**
- Modify: `gateway/bifrost/build.gradle.kts`

**Step 1: Add Micrometer Prometheus registry dependency**

Add to dependencies block in `gateway/bifrost/build.gradle.kts`:

```kotlin
    // Metrics
    implementation("io.micrometer:micrometer-registry-prometheus:1.12.0")
```

**Step 2: Verify build compiles**

Run: `cd gateway/bifrost && ./gradlew build --dry-run`

Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add gateway/bifrost/build.gradle.kts
git commit -m "feat(bifrost): add Micrometer Prometheus dependency"
```

---

### Task 3: Create MetricsCollector Service

**Files:**
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/MetricsCollector.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/metrics/MetricsCollectorTest.kt`

**Step 1: Write the failing test**

Create `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/metrics/MetricsCollectorTest.kt`:

```kotlin
package io.orbit.bifrost.metrics

import io.micrometer.prometheus.PrometheusConfig
import io.micrometer.prometheus.PrometheusMeterRegistry
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
}
```

**Step 2: Run test to verify it fails**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.metrics.MetricsCollectorTest"`

Expected: FAIL with "Unresolved reference: MetricsCollector"

**Step 3: Write the implementation**

Create `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/MetricsCollector.kt`:

```kotlin
package io.orbit.bifrost.metrics

import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class MetricsCollector(private val registry: MeterRegistry) {

    private val activeConnections = ConcurrentHashMap<String, AtomicInteger>()

    init {
        // Register active connections gauge per virtual cluster
        // (gauges are registered lazily when first connection is tracked)
    }

    fun recordBytesProduced(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        bytes: Long
    ) {
        Counter.builder("bifrost_bytes_total")
            .tag("virtual_cluster", virtualCluster)
            .tag("topic", topic)
            .tag("service_account", serviceAccount)
            .tag("direction", "produce")
            .register(registry)
            .increment(bytes.toDouble())
    }

    fun recordBytesConsumed(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        bytes: Long
    ) {
        Counter.builder("bifrost_bytes_total")
            .tag("virtual_cluster", virtualCluster)
            .tag("topic", topic)
            .tag("service_account", serviceAccount)
            .tag("direction", "consume")
            .register(registry)
            .increment(bytes.toDouble())
    }

    fun recordMessagesProduced(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        count: Long
    ) {
        Counter.builder("bifrost_messages_total")
            .tag("virtual_cluster", virtualCluster)
            .tag("topic", topic)
            .tag("service_account", serviceAccount)
            .tag("direction", "produce")
            .register(registry)
            .increment(count.toDouble())
    }

    fun recordMessagesConsumed(
        virtualCluster: String,
        topic: String,
        serviceAccount: String,
        count: Long
    ) {
        Counter.builder("bifrost_messages_total")
            .tag("virtual_cluster", virtualCluster)
            .tag("topic", topic)
            .tag("service_account", serviceAccount)
            .tag("direction", "consume")
            .register(registry)
            .increment(count.toDouble())
    }

    fun recordRequest(
        virtualCluster: String,
        operation: String,
        durationMs: Double
    ) {
        Counter.builder("bifrost_requests_total")
            .tag("virtual_cluster", virtualCluster)
            .tag("operation", operation)
            .register(registry)
            .increment()

        Timer.builder("bifrost_request_latency_seconds")
            .tag("virtual_cluster", virtualCluster)
            .tag("operation", operation)
            .register(registry)
            .record((durationMs * 1_000_000).toLong(), TimeUnit.NANOSECONDS)
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
        activeConnections[virtualCluster]?.decrementAndGet()
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.metrics.MetricsCollectorTest"`

Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/MetricsCollector.kt \
        gateway/bifrost/src/test/kotlin/io/orbit/bifrost/metrics/MetricsCollectorTest.kt
git commit -m "feat(bifrost): add MetricsCollector for Prometheus metrics"
```

---

### Task 4: Create Metrics Admin Endpoint

**Files:**
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/MetricsEndpoint.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/metrics/MetricsEndpointTest.kt`

**Step 1: Write the failing test**

Create `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/metrics/MetricsEndpointTest.kt`:

```kotlin
package io.orbit.bifrost.metrics

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import io.micrometer.prometheus.PrometheusConfig
import io.micrometer.prometheus.PrometheusMeterRegistry
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
}
```

**Step 2: Run test to verify it fails**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.metrics.MetricsEndpointTest"`

Expected: FAIL with "Unresolved reference: configureMetricsEndpoint"

**Step 3: Write the implementation**

Create `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/MetricsEndpoint.kt`:

```kotlin
package io.orbit.bifrost.metrics

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.micrometer.prometheus.PrometheusMeterRegistry

fun Application.configureMetricsEndpoint(registry: PrometheusMeterRegistry) {
    routing {
        get("/metrics") {
            call.respondText(registry.scrape(), ContentType.Text.Plain)
        }

        get("/health") {
            call.respondText("OK", ContentType.Text.Plain)
        }

        get("/ready") {
            // Could add more sophisticated readiness checks
            call.respondText("READY", ContentType.Text.Plain)
        }
    }
}
```

**Step 4: Add Ktor dependencies if not present**

Check `gateway/bifrost/build.gradle.kts` for Ktor dependencies. If missing, add:

```kotlin
    // Ktor for admin endpoint
    implementation("io.ktor:ktor-server-core:2.3.7")
    implementation("io.ktor:ktor-server-netty:2.3.7")
    testImplementation("io.ktor:ktor-server-test-host:2.3.7")
    testImplementation("io.ktor:ktor-client-content-negotiation:2.3.7")
```

**Step 5: Run test to verify it passes**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.metrics.MetricsEndpointTest"`

Expected: BUILD SUCCESSFUL

**Step 6: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/MetricsEndpoint.kt \
        gateway/bifrost/src/test/kotlin/io/orbit/bifrost/metrics/MetricsEndpointTest.kt \
        gateway/bifrost/build.gradle.kts
git commit -m "feat(bifrost): add /metrics and /health admin endpoints"
```

---

### Task 5: Create MetricsFilter for Request Instrumentation

**Files:**
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/MetricsFilter.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/MetricsFilterTest.kt`

**Step 1: Write the failing test**

Create `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/MetricsFilterTest.kt`:

```kotlin
package io.orbit.bifrost.filter

import io.micrometer.prometheus.PrometheusConfig
import io.micrometer.prometheus.PrometheusMeterRegistry
import io.orbit.bifrost.metrics.MetricsCollector
import idp.gateway.v1.Gateway.VirtualClusterConfig
import kotlinx.coroutines.runBlocking
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.ProduceRequest
import org.apache.kafka.common.requests.FetchRequest
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import io.mockk.mockk
import kotlin.test.assertTrue

class MetricsFilterTest {
    private lateinit var registry: PrometheusMeterRegistry
    private lateinit var collector: MetricsCollector
    private lateinit var filter: MetricsFilter
    private lateinit var context: FilterContext

    @BeforeEach
    fun setup() {
        registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
        collector = MetricsCollector(registry)
        filter = MetricsFilter(collector)

        val vcConfig = VirtualClusterConfig.newBuilder()
            .setId("vc-123")
            .setTopicPrefix("test-prefix-")
            .build()

        context = FilterContext(
            virtualCluster = vcConfig,
            credentialId = "cred-123",
            username = "test-sa",
            isAuthenticated = true
        )
    }

    @Test
    fun `filter name is MetricsFilter`() {
        assertTrue(filter.name == "MetricsFilter")
    }

    @Test
    fun `filter order is high to run last`() {
        assertTrue(filter.order >= 900)
    }

    @Test
    fun `onRequest increments request counter`() = runBlocking {
        val request = mockk<ProduceRequest>(relaxed = true)

        filter.onRequest(context, ApiKeys.PRODUCE.id, request)

        val scraped = registry.scrape()
        assertTrue(scraped.contains("bifrost_requests_total"))
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.filter.MetricsFilterTest"`

Expected: FAIL with "Unresolved reference: MetricsFilter"

**Step 3: Write the implementation**

Create `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/MetricsFilter.kt`:

```kotlin
package io.orbit.bifrost.filter

import io.orbit.bifrost.metrics.MetricsCollector
import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse
import org.apache.kafka.common.requests.FetchResponse
import org.apache.kafka.common.requests.ProduceRequest

private val logger = KotlinLogging.logger {}

class MetricsFilter(
    private val metricsCollector: MetricsCollector
) : BifrostFilter {

    override val name = "MetricsFilter"
    override val order = 900  // Run late in the chain, after other filters

    private val requestStartTimes = ThreadLocal<Long>()

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        requestStartTimes.set(System.nanoTime())

        val virtualClusterId = context.virtualCluster?.id ?: "unknown"
        val operation = ApiKeys.forId(apiKey.toInt()).name

        // Record produce metrics from request
        if (apiKey == ApiKeys.PRODUCE.id) {
            recordProduceMetrics(context, request as ProduceRequest)
        }

        return FilterResult.Pass(request)
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        val virtualClusterId = context.virtualCluster?.id ?: "unknown"
        val operation = ApiKeys.forId(apiKey.toInt()).name

        // Calculate duration
        val startTime = requestStartTimes.get() ?: System.nanoTime()
        val durationMs = (System.nanoTime() - startTime) / 1_000_000.0
        requestStartTimes.remove()

        // Record request latency
        metricsCollector.recordRequest(
            virtualCluster = virtualClusterId,
            operation = operation,
            durationMs = durationMs
        )

        // Record fetch (consume) metrics from response
        if (apiKey == ApiKeys.FETCH.id) {
            recordFetchMetrics(context, response as FetchResponse<*>)
        }

        return FilterResult.Pass(response)
    }

    private fun recordProduceMetrics(context: FilterContext, request: ProduceRequest) {
        val virtualClusterId = context.virtualCluster?.id ?: "unknown"
        val serviceAccount = context.username ?: "unknown"

        request.data().topicData().forEach { topicData ->
            val topic = topicData.name()
            var totalBytes = 0L
            var totalMessages = 0L

            topicData.partitionData().forEach { partition ->
                partition.records()?.let { records ->
                    totalBytes += records.sizeInBytes()
                    totalMessages += records.count()
                }
            }

            if (totalBytes > 0) {
                metricsCollector.recordBytesProduced(
                    virtualCluster = virtualClusterId,
                    topic = topic,
                    serviceAccount = serviceAccount,
                    bytes = totalBytes
                )
            }

            if (totalMessages > 0) {
                metricsCollector.recordMessagesProduced(
                    virtualCluster = virtualClusterId,
                    topic = topic,
                    serviceAccount = serviceAccount,
                    count = totalMessages
                )
            }
        }
    }

    private fun recordFetchMetrics(context: FilterContext, response: FetchResponse<*>) {
        val virtualClusterId = context.virtualCluster?.id ?: "unknown"
        val serviceAccount = context.username ?: "unknown"

        response.data().responses().forEach { topicResponse ->
            val topic = topicResponse.topic()
            var totalBytes = 0L
            var totalMessages = 0L

            topicResponse.partitions().forEach { partition ->
                partition.records()?.let { records ->
                    totalBytes += records.sizeInBytes()
                    totalMessages += records.count()
                }
            }

            if (totalBytes > 0) {
                metricsCollector.recordBytesConsumed(
                    virtualCluster = virtualClusterId,
                    topic = topic,
                    serviceAccount = serviceAccount,
                    bytes = totalBytes
                )
            }

            if (totalMessages > 0) {
                metricsCollector.recordMessagesConsumed(
                    virtualCluster = virtualClusterId,
                    topic = topic,
                    serviceAccount = serviceAccount,
                    count = totalMessages
                )
            }
        }
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.filter.MetricsFilterTest"`

Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/MetricsFilter.kt \
        gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/MetricsFilterTest.kt
git commit -m "feat(bifrost): add MetricsFilter for produce/consume instrumentation"
```

---

## Phase 6.4: Data Model

### Task 6: Extend KafkaUsageMetrics Collection

**Files:**
- Modify: `orbit-www/src/collections/kafka/KafkaUsageMetrics.ts`

**Step 1: Add new fields to collection**

Update `orbit-www/src/collections/kafka/KafkaUsageMetrics.ts` to add application, virtualCluster, serviceAccount, and hourBucket fields:

```typescript
import type { CollectionConfig, Where } from 'payload'

export const KafkaUsageMetrics: CollectionConfig = {
  slug: 'kafka-usage-metrics',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['application', 'virtualCluster', 'hourBucket', 'bytesIn', 'bytesOut'],
    description: 'Hourly usage metrics for Kafka applications',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    // Relationships
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      required: true,
      index: true,
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      required: true,
      index: true,
    },
    {
      name: 'topic',
      type: 'relationship',
      relationTo: 'kafka-topics',
      index: true,
    },
    {
      name: 'serviceAccount',
      type: 'relationship',
      relationTo: 'kafka-service-accounts',
      index: true,
    },
    // Time bucket
    {
      name: 'hourBucket',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Start of the hour this record represents (UTC)',
      },
    },
    // Message metrics
    {
      name: 'messagesIn',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description: 'Messages produced (ingress)',
      },
    },
    {
      name: 'messagesOut',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description: 'Messages consumed (egress)',
      },
    },
    // Byte metrics
    {
      name: 'bytesIn',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description: 'Bytes produced (ingress)',
      },
    },
    {
      name: 'bytesOut',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description: 'Bytes consumed (egress)',
      },
    },
  ],
  timestamps: true,
  indexes: [
    // Composite index for efficient queries
    {
      fields: { virtualCluster: 1, hourBucket: 1 },
    },
    {
      fields: { application: 1, hourBucket: 1 },
    },
  ],
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd orbit-www && bun run typecheck`

Expected: No errors

**Step 3: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaUsageMetrics.ts
git commit -m "feat(collections): extend KafkaUsageMetrics with app/vCluster/hourBucket"
```

---

### Task 7: Create KafkaChargebackRates Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/KafkaChargebackRates.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the collection file**

Create `orbit-www/src/collections/kafka/KafkaChargebackRates.ts`:

```typescript
import type { CollectionConfig } from 'payload'

export const KafkaChargebackRates: CollectionConfig = {
  slug: 'kafka-chargeback-rates',
  admin: {
    useAsTitle: 'effectiveDate',
    group: 'Kafka',
    defaultColumns: ['effectiveDate', 'costPerGBIn', 'costPerGBOut', 'costPerMillionMessages'],
    description: 'System-wide chargeback rates for Kafka usage billing',
  },
  access: {
    // Only platform admins can manage rates
    read: ({ req: { user } }) => user?.collection === 'users',
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'costPerGBIn',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per GB of ingress (produce) traffic. Example: 0.10 = $0.10/GB',
        step: 0.01,
      },
    },
    {
      name: 'costPerGBOut',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per GB of egress (consume) traffic. Example: 0.05 = $0.05/GB',
        step: 0.01,
      },
    },
    {
      name: 'costPerMillionMessages',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per million messages. Example: 0.01 = $0.01/million',
        step: 0.001,
      },
    },
    {
      name: 'effectiveDate',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Date from which these rates apply. Most recent rate before billing period start is used.',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'Internal notes about this rate change',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Export from kafka index**

Add to `orbit-www/src/collections/kafka/index.ts`:

```typescript
// Billing
export { KafkaChargebackRates } from './KafkaChargebackRates'
```

**Step 3: Register in payload.config.ts**

Add import:

```typescript
import {
  // ... existing imports
  KafkaChargebackRates,
} from './collections/kafka'
```

Add to collections array:

```typescript
    KafkaChargebackRates,
```

**Step 4: Verify TypeScript compiles**

Run: `cd orbit-www && bun run typecheck`

Expected: No errors

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaChargebackRates.ts \
        orbit-www/src/collections/kafka/index.ts \
        orbit-www/src/payload.config.ts
git commit -m "feat(collections): add KafkaChargebackRates for billing configuration"
```

---

## Phase 6.5-6.6: Chargeback Logic

### Task 8: Create Chargeback Types

**Files:**
- Create: `orbit-www/src/lib/billing/types.ts`

**Step 1: Create types file**

Create `orbit-www/src/lib/billing/types.ts`:

```typescript
export interface ChargebackInput {
  workspaceId?: string
  applicationId?: string
  periodStart: Date
  periodEnd: Date
}

export interface ChargebackLineItem {
  workspaceId: string
  workspaceName: string
  applicationId: string
  applicationName: string
  ingressGB: number
  egressGB: number
  messageCount: number
  ingressCost: number
  egressCost: number
  messageCost: number
  totalCost: number
}

export interface ChargebackRates {
  costPerGBIn: number
  costPerGBOut: number
  costPerMillionMessages: number
  effectiveDate: Date
}

export interface ChargebackSummary {
  periodStart: Date
  periodEnd: Date
  rates: ChargebackRates
  lineItems: ChargebackLineItem[]
  totalIngressGB: number
  totalEgressGB: number
  totalMessages: number
  totalCost: number
}

export const BYTES_PER_GB = 1024 * 1024 * 1024
```

**Step 2: Commit**

```bash
mkdir -p orbit-www/src/lib/billing
git add orbit-www/src/lib/billing/types.ts
git commit -m "feat(billing): add chargeback type definitions"
```

---

### Task 9: Create Chargeback Calculation Service

**Files:**
- Create: `orbit-www/src/lib/billing/chargeback.ts`
- Test: `orbit-www/src/lib/billing/chargeback.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/lib/billing/chargeback.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateChargebackFromMetrics } from './chargeback'
import { BYTES_PER_GB } from './types'

describe('calculateChargebackFromMetrics', () => {
  const mockRates = {
    costPerGBIn: 0.10,
    costPerGBOut: 0.05,
    costPerMillionMessages: 0.01,
    effectiveDate: new Date('2026-01-01'),
  }

  it('calculates costs correctly for a single application', () => {
    const metrics = [
      {
        applicationId: 'app-1',
        applicationName: 'test-app',
        workspaceId: 'ws-1',
        workspaceName: 'test-workspace',
        bytesIn: BYTES_PER_GB * 10, // 10 GB
        bytesOut: BYTES_PER_GB * 5,  // 5 GB
        messagesIn: 1_000_000,
        messagesOut: 500_000,
      },
    ]

    const result = calculateChargebackFromMetrics(metrics, mockRates)

    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].ingressGB).toBeCloseTo(10)
    expect(result.lineItems[0].egressGB).toBeCloseTo(5)
    expect(result.lineItems[0].ingressCost).toBeCloseTo(1.0)  // 10 * 0.10
    expect(result.lineItems[0].egressCost).toBeCloseTo(0.25) // 5 * 0.05
    expect(result.lineItems[0].messageCost).toBeCloseTo(0.015) // 1.5M * 0.01
    expect(result.totalCost).toBeCloseTo(1.265)
  })

  it('aggregates metrics across multiple records for same application', () => {
    const metrics = [
      {
        applicationId: 'app-1',
        applicationName: 'test-app',
        workspaceId: 'ws-1',
        workspaceName: 'test-workspace',
        bytesIn: BYTES_PER_GB,
        bytesOut: 0,
        messagesIn: 100,
        messagesOut: 0,
      },
      {
        applicationId: 'app-1',
        applicationName: 'test-app',
        workspaceId: 'ws-1',
        workspaceName: 'test-workspace',
        bytesIn: BYTES_PER_GB,
        bytesOut: 0,
        messagesIn: 100,
        messagesOut: 0,
      },
    ]

    const result = calculateChargebackFromMetrics(metrics, mockRates)

    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].ingressGB).toBeCloseTo(2)
    expect(result.totalIngressGB).toBeCloseTo(2)
  })

  it('returns empty result for no metrics', () => {
    const result = calculateChargebackFromMetrics([], mockRates)

    expect(result.lineItems).toHaveLength(0)
    expect(result.totalCost).toBe(0)
  })

  it('sorts line items by total cost descending', () => {
    const metrics = [
      {
        applicationId: 'app-1',
        applicationName: 'small-app',
        workspaceId: 'ws-1',
        workspaceName: 'workspace',
        bytesIn: BYTES_PER_GB,
        bytesOut: 0,
        messagesIn: 0,
        messagesOut: 0,
      },
      {
        applicationId: 'app-2',
        applicationName: 'large-app',
        workspaceId: 'ws-1',
        workspaceName: 'workspace',
        bytesIn: BYTES_PER_GB * 100,
        bytesOut: 0,
        messagesIn: 0,
        messagesOut: 0,
      },
    ]

    const result = calculateChargebackFromMetrics(metrics, mockRates)

    expect(result.lineItems[0].applicationName).toBe('large-app')
    expect(result.lineItems[1].applicationName).toBe('small-app')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && bun run test src/lib/billing/chargeback.test.ts`

Expected: FAIL with "cannot find module './chargeback'"

**Step 3: Write the implementation**

Create `orbit-www/src/lib/billing/chargeback.ts`:

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'
import type {
  ChargebackInput,
  ChargebackLineItem,
  ChargebackRates,
  ChargebackSummary,
} from './types'
import { BYTES_PER_GB } from './types'

interface AggregatedMetric {
  applicationId: string
  applicationName: string
  workspaceId: string
  workspaceName: string
  bytesIn: number
  bytesOut: number
  messagesIn: number
  messagesOut: number
}

/**
 * Pure function to calculate chargeback from pre-aggregated metrics.
 * Used by both the main calculateChargeback function and tests.
 */
export function calculateChargebackFromMetrics(
  metrics: AggregatedMetric[],
  rates: ChargebackRates
): Omit<ChargebackSummary, 'periodStart' | 'periodEnd' | 'rates'> {
  // Aggregate by application
  const byApp = new Map<string, AggregatedMetric>()

  for (const metric of metrics) {
    const key = metric.applicationId
    const existing = byApp.get(key)

    if (existing) {
      existing.bytesIn += metric.bytesIn
      existing.bytesOut += metric.bytesOut
      existing.messagesIn += metric.messagesIn
      existing.messagesOut += metric.messagesOut
    } else {
      byApp.set(key, { ...metric })
    }
  }

  // Calculate costs
  const lineItems: ChargebackLineItem[] = []
  let totalIngressGB = 0
  let totalEgressGB = 0
  let totalMessages = 0
  let totalCost = 0

  for (const agg of byApp.values()) {
    const ingressGB = agg.bytesIn / BYTES_PER_GB
    const egressGB = agg.bytesOut / BYTES_PER_GB
    const messageCount = agg.messagesIn + agg.messagesOut

    const ingressCost = ingressGB * rates.costPerGBIn
    const egressCost = egressGB * rates.costPerGBOut
    const messageCost = (messageCount / 1_000_000) * rates.costPerMillionMessages
    const itemTotal = ingressCost + egressCost + messageCost

    lineItems.push({
      workspaceId: agg.workspaceId,
      workspaceName: agg.workspaceName,
      applicationId: agg.applicationId,
      applicationName: agg.applicationName,
      ingressGB,
      egressGB,
      messageCount,
      ingressCost,
      egressCost,
      messageCost,
      totalCost: itemTotal,
    })

    totalIngressGB += ingressGB
    totalEgressGB += egressGB
    totalMessages += messageCount
    totalCost += itemTotal
  }

  // Sort by total cost descending
  lineItems.sort((a, b) => b.totalCost - a.totalCost)

  return {
    lineItems,
    totalIngressGB,
    totalEgressGB,
    totalMessages,
    totalCost,
  }
}

/**
 * Main chargeback calculation function that queries Payload for metrics and rates.
 */
export async function calculateChargeback(
  input: ChargebackInput
): Promise<ChargebackSummary> {
  const payload = await getPayload({ config })

  // 1. Fetch applicable rate
  const rateResult = await payload.find({
    collection: 'kafka-chargeback-rates',
    where: {
      effectiveDate: { less_than_equal: input.periodStart },
    },
    sort: '-effectiveDate',
    limit: 1,
  })

  if (rateResult.docs.length === 0) {
    throw new Error('No chargeback rate configured for this period')
  }

  const rateDoc = rateResult.docs[0]
  const rates: ChargebackRates = {
    costPerGBIn: rateDoc.costPerGBIn,
    costPerGBOut: rateDoc.costPerGBOut,
    costPerMillionMessages: rateDoc.costPerMillionMessages,
    effectiveDate: new Date(rateDoc.effectiveDate),
  }

  // 2. Build query filters
  const where: Record<string, unknown> = {
    hourBucket: {
      greater_than_equal: input.periodStart,
      less_than: input.periodEnd,
    },
  }

  if (input.workspaceId) {
    where.workspace = { equals: input.workspaceId }
  }

  if (input.applicationId) {
    where.application = { equals: input.applicationId }
  }

  // 3. Query metrics
  const metricsResult = await payload.find({
    collection: 'kafka-usage-metrics',
    where,
    limit: 10000,
    depth: 2,
  })

  // 4. Transform to aggregated format
  const metrics: AggregatedMetric[] = metricsResult.docs.map(doc => {
    const app = doc.application as { id: string; name: string; workspace: { id: string; name: string } }
    return {
      applicationId: app.id,
      applicationName: app.name,
      workspaceId: app.workspace.id,
      workspaceName: app.workspace.name,
      bytesIn: doc.bytesIn || 0,
      bytesOut: doc.bytesOut || 0,
      messagesIn: doc.messagesIn || 0,
      messagesOut: doc.messagesOut || 0,
    }
  })

  // 5. Calculate
  const result = calculateChargebackFromMetrics(metrics, rates)

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    rates,
    ...result,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && bun run test src/lib/billing/chargeback.test.ts`

Expected: All tests pass

**Step 5: Commit**

```bash
git add orbit-www/src/lib/billing/chargeback.ts \
        orbit-www/src/lib/billing/chargeback.test.ts
git commit -m "feat(billing): add chargeback calculation service with tests"
```

---

### Task 10: Create CSV Export Server Actions

**Files:**
- Create: `orbit-www/src/app/(frontend)/[workspace]/kafka/billing/actions.ts`
- Create: `orbit-www/src/app/(frontend)/platform/kafka/billing/actions.ts`

**Step 1: Create workspace export action**

Create directories and file `orbit-www/src/app/(frontend)/[workspace]/kafka/billing/actions.ts`:

```typescript
'use server'

import { calculateChargeback } from '@/lib/billing/chargeback'
import { format } from 'date-fns'

export async function exportWorkspaceChargebackCSV(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{ filename: string; content: string }> {
  const summary = await calculateChargeback({
    workspaceId,
    periodStart,
    periodEnd,
  })

  const headers = [
    'Workspace',
    'Application',
    'Ingress (GB)',
    'Egress (GB)',
    'Messages',
    'Ingress Cost',
    'Egress Cost',
    'Message Cost',
    'Total Cost',
  ]

  const rows = summary.lineItems.map(item => [
    item.workspaceName,
    item.applicationName,
    item.ingressGB.toFixed(2),
    item.egressGB.toFixed(2),
    item.messageCount.toString(),
    `$${item.ingressCost.toFixed(2)}`,
    `$${item.egressCost.toFixed(2)}`,
    `$${item.messageCost.toFixed(2)}`,
    `$${item.totalCost.toFixed(2)}`,
  ])

  // Add totals row
  rows.push([
    'TOTAL',
    '',
    summary.totalIngressGB.toFixed(2),
    summary.totalEgressGB.toFixed(2),
    summary.totalMessages.toString(),
    '',
    '',
    '',
    `$${summary.totalCost.toFixed(2)}`,
  ])

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')

  const startStr = format(periodStart, 'yyyy-MM-dd')
  const endStr = format(periodEnd, 'yyyy-MM-dd')
  const filename = `kafka-chargeback-${startStr}-to-${endStr}.csv`

  return { filename, content: csv }
}
```

**Step 2: Create platform export action**

Create directories and file `orbit-www/src/app/(frontend)/platform/kafka/billing/actions.ts`:

```typescript
'use server'

import { calculateChargeback } from '@/lib/billing/chargeback'
import { format } from 'date-fns'

export async function exportPlatformChargebackCSV(
  periodStart: Date,
  periodEnd: Date
): Promise<{ filename: string; content: string }> {
  const summary = await calculateChargeback({
    periodStart,
    periodEnd,
  })

  const headers = [
    'Workspace',
    'Application',
    'Ingress (GB)',
    'Egress (GB)',
    'Messages',
    'Ingress Cost',
    'Egress Cost',
    'Message Cost',
    'Total Cost',
  ]

  const rows = summary.lineItems.map(item => [
    item.workspaceName,
    item.applicationName,
    item.ingressGB.toFixed(2),
    item.egressGB.toFixed(2),
    item.messageCount.toString(),
    `$${item.ingressCost.toFixed(2)}`,
    `$${item.egressCost.toFixed(2)}`,
    `$${item.messageCost.toFixed(2)}`,
    `$${item.totalCost.toFixed(2)}`,
  ])

  rows.push([
    'TOTAL',
    '',
    summary.totalIngressGB.toFixed(2),
    summary.totalEgressGB.toFixed(2),
    summary.totalMessages.toString(),
    '',
    '',
    '',
    `$${summary.totalCost.toFixed(2)}`,
  ])

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')

  const startStr = format(periodStart, 'yyyy-MM-dd')
  const endStr = format(periodEnd, 'yyyy-MM-dd')
  const filename = `kafka-chargeback-platform-${startStr}-to-${endStr}.csv`

  return { filename, content: csv }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && bun run typecheck`

Expected: No errors

**Step 4: Commit**

```bash
mkdir -p "orbit-www/src/app/(frontend)/[workspace]/kafka/billing"
mkdir -p "orbit-www/src/app/(frontend)/platform/kafka/billing"
git add "orbit-www/src/app/(frontend)/[workspace]/kafka/billing/actions.ts" \
        "orbit-www/src/app/(frontend)/platform/kafka/billing/actions.ts"
git commit -m "feat(billing): add CSV export server actions for chargeback"
```

---

## Phase 6.7-6.8: UI Components

### Task 11: Create UsageSummaryCards Component

**Files:**
- Create: `orbit-www/src/components/kafka/UsageSummaryCards.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/kafka/UsageSummaryCards.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowDown, ArrowUp, MessageSquare } from 'lucide-react'

interface UsageSummaryCardsProps {
  ingressGB: number
  egressGB: number
  messageCount: number
  ingressCost: number
  egressCost: number
  messageCost: number
  totalCost: number
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toFixed(0)
}

function formatGB(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} TB`
  }
  return `${value.toFixed(1)} GB`
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

export function UsageSummaryCards({
  ingressGB,
  egressGB,
  messageCount,
  ingressCost,
  egressCost,
  messageCost,
  totalCost,
}: UsageSummaryCardsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingress</CardTitle>
            <ArrowUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatGB(ingressGB)}</div>
            <p className="text-xs text-muted-foreground">{formatCost(ingressCost)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Egress</CardTitle>
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatGB(egressGB)}</div>
            <p className="text-xs text-muted-foreground">{formatCost(egressCost)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(messageCount)}</div>
            <p className="text-xs text-muted-foreground">{formatCost(messageCost)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="text-right">
        <span className="text-sm text-muted-foreground">Estimated Total: </span>
        <span className="text-lg font-semibold">{formatCost(totalCost)}</span>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/kafka/UsageSummaryCards.tsx
git commit -m "feat(ui): add UsageSummaryCards component for usage display"
```

---

### Task 12: Create MonthPicker Component

**Files:**
- Create: `orbit-www/src/components/kafka/MonthPicker.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/kafka/MonthPicker.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface MonthPickerProps {
  value: Date
  onChange: (start: Date, end: Date) => void
  monthsBack?: number
}

export function MonthPicker({ value, onChange, monthsBack = 12 }: MonthPickerProps) {
  const months = Array.from({ length: monthsBack }, (_, i) => {
    const date = subMonths(new Date(), i)
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
      start: startOfMonth(date),
      end: endOfMonth(date),
    }
  })

  const handleChange = (monthValue: string) => {
    const month = months.find(m => m.value === monthValue)
    if (month) {
      onChange(month.start, month.end)
    }
  }

  return (
    <Select value={format(value, 'yyyy-MM')} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select month" />
      </SelectTrigger>
      <SelectContent>
        {months.map(month => (
          <SelectItem key={month.value} value={month.value}>
            {month.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/kafka/MonthPicker.tsx
git commit -m "feat(ui): add MonthPicker component for billing period selection"
```

---

### Task 13: Create EnvironmentBreakdownTable Component

**Files:**
- Create: `orbit-www/src/components/kafka/EnvironmentBreakdownTable.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/kafka/EnvironmentBreakdownTable.tsx`:

```typescript
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface EnvironmentBreakdown {
  environment: string
  ingressGB: number
  egressGB: number
  messageCount: number
  cost: number
}

interface EnvironmentBreakdownTableProps {
  data: EnvironmentBreakdown[]
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toFixed(0)
}

function formatGB(value: number): string {
  return `${value.toFixed(1)} GB`
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

export function EnvironmentBreakdownTable({ data }: EnvironmentBreakdownTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Environment</TableHead>
          <TableHead className="text-right">Ingress</TableHead>
          <TableHead className="text-right">Egress</TableHead>
          <TableHead className="text-right">Messages</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map(row => (
          <TableRow key={row.environment}>
            <TableCell className="font-medium">{row.environment}</TableCell>
            <TableCell className="text-right">{formatGB(row.ingressGB)}</TableCell>
            <TableCell className="text-right">{formatGB(row.egressGB)}</TableCell>
            <TableCell className="text-right">{formatNumber(row.messageCount)}</TableCell>
            <TableCell className="text-right">{formatCost(row.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/kafka/EnvironmentBreakdownTable.tsx
git commit -m "feat(ui): add EnvironmentBreakdownTable component"
```

---

### Task 14: Create ChargebackTable Component

**Files:**
- Create: `orbit-www/src/components/kafka/ChargebackTable.tsx`

**Step 1: Create the component**

Create `orbit-www/src/components/kafka/ChargebackTable.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { ChargebackLineItem } from '@/lib/billing/types'

interface ChargebackTableProps {
  data: ChargebackLineItem[]
  pageSize?: number
}

type SortField = 'workspaceName' | 'applicationName' | 'ingressGB' | 'egressGB' | 'totalCost'
type SortDirection = 'asc' | 'desc'

function formatGB(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} TB`
  }
  return `${value.toFixed(1)} GB`
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

export function ChargebackTable({ data, pageSize = 25 }: ChargebackTableProps) {
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('totalCost')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(0)

  // Filter
  const filtered = data.filter(
    item =>
      item.workspaceName.toLowerCase().includes(search.toLowerCase()) ||
      item.applicationName.toLowerCase().includes(search.toLowerCase())
  )

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortField]
    const bVal = b[sortField]
    const modifier = sortDirection === 'asc' ? 1 : -1

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * modifier
    }
    return ((aVal as number) - (bVal as number)) * modifier
  })

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize)
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-4 w-4 inline ml-1" />
    ) : (
      <ChevronDown className="h-4 w-4 inline ml-1" />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search workspace or application..."
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer"
              onClick={() => handleSort('workspaceName')}
            >
              Workspace
              <SortIcon field="workspaceName" />
            </TableHead>
            <TableHead
              className="cursor-pointer"
              onClick={() => handleSort('applicationName')}
            >
              Application
              <SortIcon field="applicationName" />
            </TableHead>
            <TableHead
              className="text-right cursor-pointer"
              onClick={() => handleSort('ingressGB')}
            >
              Ingress
              <SortIcon field="ingressGB" />
            </TableHead>
            <TableHead
              className="text-right cursor-pointer"
              onClick={() => handleSort('egressGB')}
            >
              Egress
              <SortIcon field="egressGB" />
            </TableHead>
            <TableHead
              className="text-right cursor-pointer"
              onClick={() => handleSort('totalCost')}
            >
              Cost
              <SortIcon field="totalCost" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginated.map(item => (
            <TableRow key={item.applicationId}>
              <TableCell>{item.workspaceName}</TableCell>
              <TableCell className="font-medium">{item.applicationName}</TableCell>
              <TableCell className="text-right">{formatGB(item.ingressGB)}</TableCell>
              <TableCell className="text-right">{formatGB(item.egressGB)}</TableCell>
              <TableCell className="text-right">{formatCost(item.totalCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sorted.length)} of{' '}
            {sorted.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/kafka/ChargebackTable.tsx
git commit -m "feat(ui): add ChargebackTable component with sort/filter/pagination"
```

---

### Task 15: Create Platform Billing Dashboard Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/billing/page.tsx`

**Step 1: Create the page**

Create `orbit-www/src/app/(frontend)/platform/kafka/billing/page.tsx`:

```typescript
import { Suspense } from 'react'
import { startOfMonth, endOfMonth } from 'date-fns'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { calculateChargeback } from '@/lib/billing/chargeback'
import { PlatformBillingClient } from './client'

async function getPlatformBillingData() {
  const now = new Date()
  const periodStart = startOfMonth(now)
  const periodEnd = endOfMonth(now)

  try {
    const summary = await calculateChargeback({
      periodStart,
      periodEnd,
    })
    return { summary, error: null }
  } catch (error) {
    return { summary: null, error: 'Failed to load billing data' }
  }
}

export default async function PlatformKafkaBillingPage() {
  const { summary, error } = await getPlatformBillingData()

  if (error || !summary) {
    return (
      <div className="container py-8">
        <Card>
          <CardHeader>
            <CardTitle>Platform Kafka Billing</CardTitle>
            <CardDescription>
              {error || 'No billing data available. Configure chargeback rates first.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container py-8">
      <Suspense fallback={<div>Loading...</div>}>
        <PlatformBillingClient initialSummary={summary} />
      </Suspense>
    </div>
  )
}
```

**Step 2: Create client component**

Create `orbit-www/src/app/(frontend)/platform/kafka/billing/client.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { startOfMonth, endOfMonth } from 'date-fns'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UsageSummaryCards } from '@/components/kafka/UsageSummaryCards'
import { MonthPicker } from '@/components/kafka/MonthPicker'
import { ChargebackTable } from '@/components/kafka/ChargebackTable'
import { calculateChargeback } from '@/lib/billing/chargeback'
import { exportPlatformChargebackCSV } from './actions'
import type { ChargebackSummary } from '@/lib/billing/types'

interface PlatformBillingClientProps {
  initialSummary: ChargebackSummary
}

export function PlatformBillingClient({ initialSummary }: PlatformBillingClientProps) {
  const [summary, setSummary] = useState(initialSummary)
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [isPending, startTransition] = useTransition()
  const [isExporting, setIsExporting] = useState(false)

  const handleMonthChange = (start: Date, end: Date) => {
    setSelectedMonth(start)
    startTransition(async () => {
      const newSummary = await calculateChargeback({
        periodStart: start,
        periodEnd: end,
      })
      setSummary(newSummary)
    })
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const { filename, content } = await exportPlatformChargebackCSV(
        summary.periodStart,
        summary.periodEnd
      )

      // Trigger download
      const blob = new Blob([content], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Kafka Billing</h1>
          <p className="text-muted-foreground">
            Usage and chargeback across all workspaces
          </p>
        </div>
        <div className="flex items-center gap-4">
          <MonthPicker value={selectedMonth} onChange={handleMonthChange} />
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Platform-wide usage for the selected period</CardDescription>
            </CardHeader>
            <CardContent>
              <UsageSummaryCards
                ingressGB={summary.totalIngressGB}
                egressGB={summary.totalEgressGB}
                messageCount={summary.totalMessages}
                ingressCost={summary.totalIngressGB * summary.rates.costPerGBIn}
                egressCost={summary.totalEgressGB * summary.rates.costPerGBOut}
                messageCost={(summary.totalMessages / 1_000_000) * summary.rates.costPerMillionMessages}
                totalCost={summary.totalCost}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By Application</CardTitle>
              <CardDescription>
                {summary.lineItems.length} application{summary.lineItems.length !== 1 ? 's' : ''} with usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChargebackTable data={summary.lineItems} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd orbit-www && bun run typecheck`

Expected: No errors

**Step 4: Commit**

```bash
git add "orbit-www/src/app/(frontend)/platform/kafka/billing/page.tsx" \
        "orbit-www/src/app/(frontend)/platform/kafka/billing/client.tsx"
git commit -m "feat(ui): add platform Kafka billing dashboard page"
```

---

## Phase 6.3: Temporal Workflow (Deferred)

The Temporal workflow for metrics rollup requires integration with both Prometheus and Payload APIs. This should be implemented after the infrastructure and data model are validated.

### Task 16: Create Metrics Rollup Workflow

**Files:**
- Create: `temporal-workflows/internal/activities/metrics_activities.go`
- Create: `temporal-workflows/internal/workflows/metrics_rollup_workflow.go`
- Modify: `temporal-workflows/cmd/worker/main.go`

*Detailed implementation deferred - will be added once Prometheus integration is tested.*

---

## Verification Checklist

After completing all tasks:

1. **Infrastructure:**
   - [ ] `docker-compose up` includes Prometheus on port 9090
   - [ ] Prometheus UI accessible at http://localhost:9090

2. **Bifrost Gateway:**
   - [ ] Gateway builds successfully with `./gradlew build`
   - [ ] `/metrics` endpoint returns Prometheus format
   - [ ] `/health` endpoint returns OK
   - [ ] MetricsFilter tests pass

3. **Data Model:**
   - [ ] KafkaUsageMetrics collection has new fields
   - [ ] KafkaChargebackRates collection exists
   - [ ] Payload admin shows both collections

4. **Chargeback Logic:**
   - [ ] Unit tests pass for chargeback calculation
   - [ ] CSV export generates valid file

5. **UI:**
   - [ ] Platform billing page loads
   - [ ] Month picker changes data
   - [ ] CSV download works
   - [ ] Table sorting/filtering works

---

## Execution

Plan complete and saved to `docs/plans/2026-01-08-bifrost-phase6-implementation-plan.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
