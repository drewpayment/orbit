# Bifrost Callback Client & Lineage Activities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the lineage data flow from Bifrost gateway to Payload CMS by implementing the gRPC callback client and Temporal activity API calls.

**Architecture:** Bifrost accumulates client activity (produce/consume) and sends batches via gRPC to the bifrost-callback Go service, which triggers Temporal workflows. The Temporal activities call the Payload CMS API to upsert lineage edges and manage snapshots.

**Tech Stack:** Kotlin/gRPC (Bifrost), Go (Temporal activities), Payload CMS REST API

---

## Gap 1: Kotlin gRPC Callback Client

### Task 1: Build Bifrost to Generate Proto Stubs

**Files:**
- Generated: `gateway/bifrost/build/generated/source/proto/main/grpckt/idp/gateway/v1/`

**Step 1: Build Bifrost project**

```bash
cd gateway/bifrost && ./gradlew build -x test
```

Expected: Build succeeds, proto stubs generated in `build/generated/source/proto/main/`

**Step 2: Verify stubs exist**

```bash
ls gateway/bifrost/build/generated/source/proto/main/grpckt/idp/gateway/v1/
```

Expected: `GatewayGrpcKt.kt` and related files exist

**Step 3: Commit (no changes needed, just verification)**

---

### Task 2: Implement GrpcBifrostCallbackClient

**Files:**
- Modify: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/callback/BifrostCallbackClient.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/callback/BifrostCallbackClientTest.kt`

**Step 1: Write the failing test**

Create `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/callback/BifrostCallbackClientTest.kt`:

```kotlin
package io.orbit.bifrost.callback

import io.grpc.ManagedChannel
import io.grpc.inprocess.InProcessChannelBuilder
import io.grpc.inprocess.InProcessServerBuilder
import io.grpc.stub.StreamObserver
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import idp.gateway.v1.BifrostCallbackServiceGrpc
import idp.gateway.v1.Gateway.EmitClientActivityRequest
import idp.gateway.v1.Gateway.EmitClientActivityResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals

class GrpcBifrostCallbackClientTest {

    private lateinit var channel: ManagedChannel
    private lateinit var serverName: String
    private var capturedRequest: EmitClientActivityRequest? = null

    @BeforeEach
    fun setUp() {
        serverName = InProcessServerBuilder.generateName()

        // Create a mock service implementation
        val serviceImpl = object : BifrostCallbackServiceGrpc.BifrostCallbackServiceImplBase() {
            override fun emitClientActivity(
                request: EmitClientActivityRequest,
                responseObserver: StreamObserver<EmitClientActivityResponse>
            ) {
                capturedRequest = request
                responseObserver.onNext(
                    EmitClientActivityResponse.newBuilder()
                        .setSuccess(true)
                        .setRecordsProcessed(request.recordsCount)
                        .build()
                )
                responseObserver.onCompleted()
            }
        }

        // Start in-process server
        InProcessServerBuilder.forName(serverName)
            .directExecutor()
            .addService(serviceImpl)
            .build()
            .start()

        channel = InProcessChannelBuilder.forName(serverName)
            .directExecutor()
            .build()
    }

    @AfterEach
    fun tearDown() {
        channel.shutdownNow()
        channel.awaitTermination(5, TimeUnit.SECONDS)
    }

    @Test
    fun `emitClientActivity sends records via gRPC`() {
        val client = GrpcBifrostCallbackClient(channel)
        val now = Instant.now()

        val records = listOf(
            ActivityRecord(
                virtualClusterId = "vc-123",
                serviceAccountId = "sa-456",
                topicVirtualName = "my-topic",
                direction = "produce",
                consumerGroupId = null,
                bytes = 1024,
                messageCount = 10,
                windowStart = now.minusSeconds(30),
                windowEnd = now
            )
        )

        client.emitClientActivity(records)

        // Verify the request was sent correctly
        assertEquals(1, capturedRequest?.recordsCount)
        val record = capturedRequest?.recordsList?.first()
        assertEquals("vc-123", record?.virtualClusterId)
        assertEquals("sa-456", record?.serviceAccountId)
        assertEquals("my-topic", record?.topicVirtualName)
        assertEquals("produce", record?.direction)
        assertEquals(1024, record?.bytes)
        assertEquals(10, record?.messageCount)
    }

    @Test
    fun `emitClientActivity handles empty list`() {
        val client = GrpcBifrostCallbackClient(channel)

        client.emitClientActivity(emptyList())

        // Should not make a call for empty list
        assertEquals(null, capturedRequest)
    }

    @Test
    fun `emitClientActivity includes consumer group for consume direction`() {
        val client = GrpcBifrostCallbackClient(channel)
        val now = Instant.now()

        val records = listOf(
            ActivityRecord(
                virtualClusterId = "vc-123",
                serviceAccountId = "sa-456",
                topicVirtualName = "my-topic",
                direction = "consume",
                consumerGroupId = "my-consumer-group",
                bytes = 2048,
                messageCount = 20,
                windowStart = now.minusSeconds(30),
                windowEnd = now
            )
        )

        client.emitClientActivity(records)

        val record = capturedRequest?.recordsList?.first()
        assertEquals("consume", record?.direction)
        assertEquals("my-consumer-group", record?.consumerGroupId)
    }
}
```

**Step 2: Run test to verify it fails**

```bash
cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.callback.GrpcBifrostCallbackClientTest"
```

Expected: FAIL - `GrpcBifrostCallbackClient` constructor doesn't accept channel

**Step 3: Update GrpcBifrostCallbackClient implementation**

Replace contents of `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/callback/BifrostCallbackClient.kt`:

```kotlin
package io.orbit.bifrost.callback

import com.google.protobuf.Timestamp
import io.grpc.ManagedChannel
import io.grpc.ManagedChannelBuilder
import idp.gateway.v1.BifrostCallbackServiceGrpc
import idp.gateway.v1.Gateway.ClientActivityRecord
import idp.gateway.v1.Gateway.EmitClientActivityRequest
import mu.KotlinLogging
import java.util.concurrent.TimeUnit

private val logger = KotlinLogging.logger {}

/**
 * Client for calling Orbit's BifrostCallbackService.
 *
 * This client is used to report activity data from the gateway back to Orbit
 * for lineage tracking and observability.
 */
interface BifrostCallbackClient {
    /**
     * Emits a batch of client activity records to Orbit.
     *
     * @param records List of activity records to send
     * @throws Exception if the gRPC call fails
     */
    fun emitClientActivity(records: List<ActivityRecord>)

    /**
     * Shuts down the client and releases resources.
     */
    fun shutdown()
}

/**
 * No-op implementation for testing or when callback is disabled.
 */
class NoOpBifrostCallbackClient : BifrostCallbackClient {
    override fun emitClientActivity(records: List<ActivityRecord>) {
        logger.debug { "NoOp callback client: would emit ${records.size} activity records" }
    }

    override fun shutdown() {
        // No-op
    }
}

/**
 * gRPC implementation of BifrostCallbackClient.
 *
 * @param host Orbit callback service host
 * @param port Orbit callback service port
 */
class GrpcBifrostCallbackClient private constructor(
    private val channel: ManagedChannel,
    private val stub: BifrostCallbackServiceGrpc.BifrostCallbackServiceBlockingStub
) : BifrostCallbackClient {

    /**
     * Primary constructor for production use.
     */
    constructor(host: String, port: Int) : this(
        ManagedChannelBuilder.forAddress(host, port)
            .usePlaintext()
            .build()
    )

    /**
     * Constructor that accepts a pre-built channel (for testing).
     */
    constructor(channel: ManagedChannel) : this(
        channel,
        BifrostCallbackServiceGrpc.newBlockingStub(channel)
    )

    override fun emitClientActivity(records: List<ActivityRecord>) {
        if (records.isEmpty()) {
            return
        }

        logger.info { "Emitting ${records.size} activity records to Orbit" }

        val protoRecords = records.map { record ->
            ClientActivityRecord.newBuilder()
                .setVirtualClusterId(record.virtualClusterId)
                .setServiceAccountId(record.serviceAccountId)
                .setTopicVirtualName(record.topicVirtualName)
                .setDirection(record.direction)
                .apply {
                    record.consumerGroupId?.let { setConsumerGroupId(it) }
                }
                .setBytes(record.bytes)
                .setMessageCount(record.messageCount)
                .setWindowStart(
                    Timestamp.newBuilder()
                        .setSeconds(record.windowStart.epochSecond)
                        .setNanos(record.windowStart.nano)
                        .build()
                )
                .setWindowEnd(
                    Timestamp.newBuilder()
                        .setSeconds(record.windowEnd.epochSecond)
                        .setNanos(record.windowEnd.nano)
                        .build()
                )
                .build()
        }

        val request = EmitClientActivityRequest.newBuilder()
            .addAllRecords(protoRecords)
            .build()

        try {
            val response = stub.emitClientActivity(request)
            logger.info {
                "Successfully emitted activity: processed=${response.recordsProcessed}, success=${response.success}"
            }
        } catch (e: Exception) {
            logger.error(e) { "Failed to emit activity records to Orbit" }
            throw e
        }
    }

    override fun shutdown() {
        logger.info { "Shutting down Bifrost callback client" }
        channel.shutdown()
        try {
            if (!channel.awaitTermination(5, TimeUnit.SECONDS)) {
                channel.shutdownNow()
                if (!channel.awaitTermination(5, TimeUnit.SECONDS)) {
                    logger.warn { "Channel did not terminate cleanly" }
                }
            }
        } catch (e: InterruptedException) {
            channel.shutdownNow()
            Thread.currentThread().interrupt()
        }
    }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.callback.GrpcBifrostCallbackClientTest"
```

Expected: PASS

**Step 5: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/callback/BifrostCallbackClient.kt
git add gateway/bifrost/src/test/kotlin/io/orbit/bifrost/callback/BifrostCallbackClientTest.kt
git commit -m "feat(bifrost): implement gRPC callback client for activity emission

- Add GrpcBifrostCallbackClient with actual gRPC channel and stub
- Convert ActivityRecord to proto ClientActivityRecord
- Add shutdown() method for graceful cleanup
- Add unit tests with in-process gRPC server

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Gap 2: Temporal Lineage Activities

### Task 3: Update LineageActivitiesImpl to use PayloadClient

**Files:**
- Modify: `temporal-workflows/internal/activities/lineage_activities.go`
- Test: `temporal-workflows/internal/activities/lineage_activities_test.go`

**Step 1: Write the failing test for ProcessActivityBatch**

Create `temporal-workflows/internal/activities/lineage_activities_test.go`:

```go
package activities

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"log/slog"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessActivityBatch(t *testing.T) {
	// Track API calls
	var apiCalls []string
	var createData map[string]any

	// Mock Payload API server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiCalls = append(apiCalls, r.Method+" "+r.URL.Path)

		// GET kafka-virtual-clusters
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-virtual-clusters") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{
						"id":          "vc-123",
						"application": "app-456",
						"topicPrefix": "ws-app-dev-",
					},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-applications (for application details)
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-applications") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{
						"id":        "app-456",
						"workspace": "ws-789",
					},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-service-accounts
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-service-accounts") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{
						"id":          "sa-456",
						"application": "app-456",
					},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-topics
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-topics") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{
						"id":          "topic-789",
						"application": "app-owner",
						"workspace":   "ws-owner",
					},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-lineage-edges (check existing)
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			// Return empty - no existing edge
			json.NewEncoder(w).Encode(map[string]any{
				"docs":      []map[string]any{},
				"totalDocs": 0,
			})
			return
		}

		// POST kafka-lineage-edges (create new)
		if r.Method == "POST" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			json.NewDecoder(r.Body).Decode(&createData)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"doc": map[string]any{
					"id": "edge-new",
				},
			})
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	input := ProcessActivityBatchInput{
		Records: []ClientActivityRecord{
			{
				VirtualClusterID: "vc-123",
				ServiceAccountID: "sa-456",
				TopicVirtualName: "my-topic",
				Direction:        "produce",
				Bytes:            1024,
				MessageCount:     10,
				WindowStart:      "2026-01-14T10:00:00Z",
				WindowEnd:        "2026-01-14T10:00:30Z",
			},
		},
	}

	output, err := activities.ProcessActivityBatch(context.Background(), input)
	require.NoError(t, err)

	assert.Equal(t, 1, output.ProcessedCount)
	assert.Equal(t, 0, output.FailedCount)
	assert.Equal(t, 1, output.NewEdgesCount)

	// Verify API calls were made
	assert.Contains(t, apiCalls, "GET /api/kafka-virtual-clusters")
	assert.Contains(t, apiCalls, "GET /api/kafka-topics")
	assert.Contains(t, apiCalls, "GET /api/kafka-lineage-edges")
	assert.Contains(t, apiCalls, "POST /api/kafka-lineage-edges")

	// Verify edge data
	assert.Equal(t, "produce", createData["direction"])
	assert.Equal(t, int64(1024), createData["bytesLast24h"])
	assert.Equal(t, int64(10), createData["messagesLast24h"])
}

func TestProcessActivityBatch_UpdateExistingEdge(t *testing.T) {
	var patchData map[string]any
	var patchedID string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GET kafka-virtual-clusters
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-virtual-clusters") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{"id": "vc-123", "application": "app-456", "topicPrefix": "ws-app-dev-"},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-applications
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-applications") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{"id": "app-456", "workspace": "ws-789"},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-service-accounts
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-service-accounts") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{"id": "sa-456", "application": "app-456"},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-topics
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-topics") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{"id": "topic-789", "application": "app-owner", "workspace": "ws-owner"},
				},
				"totalDocs": 1,
			})
			return
		}

		// GET kafka-lineage-edges (existing edge found)
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{
						"id":              "edge-existing",
						"bytesLast24h":    int64(500),
						"messagesLast24h": int64(5),
						"bytesAllTime":    int64(10000),
						"messagesAllTime": int64(100),
					},
				},
				"totalDocs": 1,
			})
			return
		}

		// PATCH kafka-lineage-edges (update existing)
		if r.Method == "PATCH" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			parts := strings.Split(r.URL.Path, "/")
			patchedID = parts[len(parts)-1]
			json.NewDecoder(r.Body).Decode(&patchData)
			json.NewEncoder(w).Encode(map[string]any{"id": patchedID})
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	input := ProcessActivityBatchInput{
		Records: []ClientActivityRecord{
			{
				VirtualClusterID: "vc-123",
				ServiceAccountID: "sa-456",
				TopicVirtualName: "my-topic",
				Direction:        "produce",
				Bytes:            1024,
				MessageCount:     10,
				WindowStart:      "2026-01-14T10:00:00Z",
				WindowEnd:        "2026-01-14T10:00:30Z",
			},
		},
	}

	output, err := activities.ProcessActivityBatch(context.Background(), input)
	require.NoError(t, err)

	assert.Equal(t, 1, output.ProcessedCount)
	assert.Equal(t, 0, output.NewEdgesCount) // Updated, not new

	// Verify patch was called on existing edge
	assert.Equal(t, "edge-existing", patchedID)
	// Should accumulate: 500 + 1024 = 1524
	assert.Equal(t, float64(1524), patchData["bytesLast24h"])
	assert.Equal(t, float64(15), patchData["messagesLast24h"])
	// All-time: 10000 + 1024 = 11024
	assert.Equal(t, float64(11024), patchData["bytesAllTime"])
}

func TestResetStale24hMetrics(t *testing.T) {
	var patchedIDs []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GET edges with non-zero metrics
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{"id": "edge-1", "bytesLast24h": int64(100)},
					{"id": "edge-2", "bytesLast24h": int64(200)},
				},
				"totalDocs": 2,
			})
			return
		}

		// PATCH to reset metrics
		if r.Method == "PATCH" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			parts := strings.Split(r.URL.Path, "/")
			patchedIDs = append(patchedIDs, parts[len(parts)-1])
			json.NewEncoder(w).Encode(map[string]any{})
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	output, err := activities.ResetStale24hMetrics(context.Background(), ResetStale24hMetricsInput{})
	require.NoError(t, err)

	assert.Equal(t, 2, output.EdgesReset)
	assert.Contains(t, patchedIDs, "edge-1")
	assert.Contains(t, patchedIDs, "edge-2")
}

func TestMarkInactiveEdges(t *testing.T) {
	var patchedIDs []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GET active edges older than threshold
		if r.Method == "GET" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			json.NewEncoder(w).Encode(map[string]any{
				"docs": []map[string]any{
					{"id": "edge-old-1", "isActive": true},
					{"id": "edge-old-2", "isActive": true},
				},
				"totalDocs": 2,
			})
			return
		}

		// PATCH to mark inactive
		if r.Method == "PATCH" && strings.Contains(r.URL.Path, "kafka-lineage-edges") {
			parts := strings.Split(r.URL.Path, "/")
			patchedIDs = append(patchedIDs, parts[len(parts)-1])
			json.NewEncoder(w).Encode(map[string]any{})
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	output, err := activities.MarkInactiveEdges(context.Background(), MarkInactiveEdgesInput{
		HoursThreshold: 24,
	})
	require.NoError(t, err)

	assert.Equal(t, 2, output.EdgesMarked)
	assert.Contains(t, patchedIDs, "edge-old-1")
	assert.Contains(t, patchedIDs, "edge-old-2")
}
```

**Step 2: Run tests to verify they fail**

```bash
cd temporal-workflows && go test -v -run "TestProcessActivityBatch|TestResetStale24hMetrics|TestMarkInactiveEdges" ./internal/activities/
```

Expected: FAIL - `NewLineageActivities` signature mismatch

**Step 3: Implement the full lineage activities**

Replace contents of `temporal-workflows/internal/activities/lineage_activities.go`:

```go
package activities

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
)

// ClientActivityRecord represents a single activity record from Bifrost
type ClientActivityRecord struct {
	VirtualClusterID string `json:"virtualClusterId"`
	ServiceAccountID string `json:"serviceAccountId"`
	TopicVirtualName string `json:"topicVirtualName"`
	Direction        string `json:"direction"` // "produce" or "consume"
	ConsumerGroupID  string `json:"consumerGroupId,omitempty"`
	Bytes            int64  `json:"bytes"`
	MessageCount     int64  `json:"messageCount"`
	WindowStart      string `json:"windowStart"` // RFC3339 timestamp
	WindowEnd        string `json:"windowEnd"`   // RFC3339 timestamp
}

// ProcessActivityBatchInput is the input for processing a batch of activity records
type ProcessActivityBatchInput struct {
	Records []ClientActivityRecord `json:"records"`
}

// ProcessActivityBatchOutput is the output of processing activity records
type ProcessActivityBatchOutput struct {
	ProcessedCount int `json:"processedCount"`
	FailedCount    int `json:"failedCount"`
	NewEdgesCount  int `json:"newEdgesCount"`
}

// ResetStale24hMetricsInput is the input for resetting stale 24h metrics
type ResetStale24hMetricsInput struct{}

// ResetStale24hMetricsOutput is the output of resetting stale metrics
type ResetStale24hMetricsOutput struct {
	EdgesReset int `json:"edgesReset"`
}

// MarkInactiveEdgesInput is the input for marking inactive edges
type MarkInactiveEdgesInput struct {
	HoursThreshold int `json:"hoursThreshold"`
}

// MarkInactiveEdgesOutput is the output of marking inactive edges
type MarkInactiveEdgesOutput struct {
	EdgesMarked int `json:"edgesMarked"`
}

// CreateDailySnapshotsInput is the input for creating daily snapshots
type CreateDailySnapshotsInput struct {
	Date string `json:"date"` // YYYY-MM-DD format
}

// CreateDailySnapshotsOutput is the output of creating daily snapshots
type CreateDailySnapshotsOutput struct {
	SnapshotsCreated int `json:"snapshotsCreated"`
}

// LineageActivities defines the interface for lineage-related activities
type LineageActivities interface {
	ProcessActivityBatch(ctx context.Context, input ProcessActivityBatchInput) (*ProcessActivityBatchOutput, error)
	ResetStale24hMetrics(ctx context.Context, input ResetStale24hMetricsInput) (*ResetStale24hMetricsOutput, error)
	MarkInactiveEdges(ctx context.Context, input MarkInactiveEdgesInput) (*MarkInactiveEdgesOutput, error)
	CreateDailySnapshots(ctx context.Context, input CreateDailySnapshotsInput) (*CreateDailySnapshotsOutput, error)
}

// LineageActivitiesImpl implements LineageActivities
type LineageActivitiesImpl struct {
	payloadClient *clients.PayloadClient
	logger        *slog.Logger
}

// NewLineageActivities creates a new LineageActivities implementation
func NewLineageActivities(payloadClient *clients.PayloadClient, logger *slog.Logger) *LineageActivitiesImpl {
	return &LineageActivitiesImpl{
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// ProcessActivityBatch processes activity records and updates lineage edges
func (a *LineageActivitiesImpl) ProcessActivityBatch(ctx context.Context, input ProcessActivityBatchInput) (*ProcessActivityBatchOutput, error) {
	a.logger.Info("ProcessActivityBatch", "recordCount", len(input.Records))

	processed := 0
	failed := 0
	newEdges := 0

	for _, record := range input.Records {
		err := a.processRecord(ctx, record, &newEdges)
		if err != nil {
			a.logger.Error("Failed to process activity record",
				"error", err,
				"virtualClusterId", record.VirtualClusterID,
				"topic", record.TopicVirtualName)
			failed++
			continue
		}
		processed++
	}

	return &ProcessActivityBatchOutput{
		ProcessedCount: processed,
		FailedCount:    failed,
		NewEdgesCount:  newEdges,
	}, nil
}

func (a *LineageActivitiesImpl) processRecord(ctx context.Context, record ClientActivityRecord, newEdges *int) error {
	// 1. Resolve virtual cluster to get application info
	vcQuery := clients.NewQueryBuilder().
		WhereEquals("id", record.VirtualClusterID).
		Limit(1).
		Build()
	vcDocs, err := a.payloadClient.Find(ctx, "kafka-virtual-clusters", vcQuery)
	if err != nil {
		return fmt.Errorf("finding virtual cluster: %w", err)
	}
	if len(vcDocs) == 0 {
		return fmt.Errorf("virtual cluster not found: %s", record.VirtualClusterID)
	}
	vc := vcDocs[0]
	sourceAppID, _ := vc["application"].(string)

	// 2. Get application to find workspace
	appQuery := clients.NewQueryBuilder().
		WhereEquals("id", sourceAppID).
		Limit(1).
		Build()
	appDocs, err := a.payloadClient.Find(ctx, "kafka-applications", appQuery)
	if err != nil {
		return fmt.Errorf("finding application: %w", err)
	}
	if len(appDocs) == 0 {
		return fmt.Errorf("application not found: %s", sourceAppID)
	}
	sourceWorkspaceID, _ := appDocs[0]["workspace"].(string)

	// 3. Resolve topic by virtual cluster and virtual name
	topicQuery := clients.NewQueryBuilder().
		WhereEquals("virtualCluster", record.VirtualClusterID).
		WhereEquals("name", record.TopicVirtualName).
		Limit(1).
		Build()
	topicDocs, err := a.payloadClient.Find(ctx, "kafka-topics", topicQuery)
	if err != nil {
		return fmt.Errorf("finding topic: %w", err)
	}
	if len(topicDocs) == 0 {
		return fmt.Errorf("topic not found: %s in vc %s", record.TopicVirtualName, record.VirtualClusterID)
	}
	topic := topicDocs[0]
	topicID, _ := topic["id"].(string)
	targetAppID, _ := topic["application"].(string)
	targetWorkspaceID, _ := topic["workspace"].(string)

	// 4. Find or create lineage edge
	edgeQuery := clients.NewQueryBuilder().
		WhereEquals("sourceServiceAccount", record.ServiceAccountID).
		WhereEquals("topic", topicID).
		WhereEquals("direction", record.Direction).
		Limit(1).
		Build()
	edgeDocs, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", edgeQuery)
	if err != nil {
		return fmt.Errorf("finding edge: %w", err)
	}

	now := time.Now().Format(time.RFC3339)
	isCrossWorkspace := sourceWorkspaceID != targetWorkspaceID

	if len(edgeDocs) > 0 {
		// Update existing edge
		edge := edgeDocs[0]
		edgeID, _ := edge["id"].(string)

		// Accumulate metrics
		bytesLast24h := int64(0)
		if v, ok := edge["bytesLast24h"].(float64); ok {
			bytesLast24h = int64(v)
		}
		messagesLast24h := int64(0)
		if v, ok := edge["messagesLast24h"].(float64); ok {
			messagesLast24h = int64(v)
		}
		bytesAllTime := int64(0)
		if v, ok := edge["bytesAllTime"].(float64); ok {
			bytesAllTime = int64(v)
		}
		messagesAllTime := int64(0)
		if v, ok := edge["messagesAllTime"].(float64); ok {
			messagesAllTime = int64(v)
		}

		updateData := map[string]any{
			"bytesLast24h":    bytesLast24h + record.Bytes,
			"messagesLast24h": messagesLast24h + record.MessageCount,
			"bytesAllTime":    bytesAllTime + record.Bytes,
			"messagesAllTime": messagesAllTime + record.MessageCount,
			"lastSeen":        now,
			"isActive":        true,
		}

		if err := a.payloadClient.Update(ctx, "kafka-lineage-edges", edgeID, updateData); err != nil {
			return fmt.Errorf("updating edge: %w", err)
		}
	} else {
		// Create new edge
		createData := map[string]any{
			"sourceApplication":   sourceAppID,
			"sourceServiceAccount": record.ServiceAccountID,
			"sourceWorkspace":     sourceWorkspaceID,
			"topic":               topicID,
			"targetApplication":   targetAppID,
			"targetWorkspace":     targetWorkspaceID,
			"direction":           record.Direction,
			"bytesLast24h":        record.Bytes,
			"messagesLast24h":     record.MessageCount,
			"bytesAllTime":        record.Bytes,
			"messagesAllTime":     record.MessageCount,
			"firstSeen":           now,
			"lastSeen":            now,
			"isActive":            true,
			"isCrossWorkspace":    isCrossWorkspace,
		}

		if _, err := a.payloadClient.Create(ctx, "kafka-lineage-edges", createData); err != nil {
			return fmt.Errorf("creating edge: %w", err)
		}
		*newEdges++
	}

	return nil
}

// ResetStale24hMetrics resets 24h rolling metrics for all edges
func (a *LineageActivitiesImpl) ResetStale24hMetrics(ctx context.Context, input ResetStale24hMetricsInput) (*ResetStale24hMetricsOutput, error) {
	a.logger.Info("ResetStale24hMetrics")

	// Find edges with non-zero 24h metrics
	query := clients.NewQueryBuilder().
		Limit(100). // Process in batches
		Build()
	// Add custom where clause for OR condition
	query.Set("where[or][0][bytesLast24h][greater_than]", "0")
	query.Set("where[or][1][messagesLast24h][greater_than]", "0")

	docs, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", query)
	if err != nil {
		return nil, fmt.Errorf("finding edges to reset: %w", err)
	}

	resetCount := 0
	for _, edge := range docs {
		edgeID, _ := edge["id"].(string)
		if edgeID == "" {
			continue
		}

		updateData := map[string]any{
			"bytesLast24h":    0,
			"messagesLast24h": 0,
		}

		if err := a.payloadClient.Update(ctx, "kafka-lineage-edges", edgeID, updateData); err != nil {
			a.logger.Error("Failed to reset edge metrics", "edgeId", edgeID, "error", err)
			continue
		}
		resetCount++
	}

	return &ResetStale24hMetricsOutput{
		EdgesReset: resetCount,
	}, nil
}

// MarkInactiveEdges marks edges as inactive if not seen within threshold hours
func (a *LineageActivitiesImpl) MarkInactiveEdges(ctx context.Context, input MarkInactiveEdgesInput) (*MarkInactiveEdgesOutput, error) {
	a.logger.Info("MarkInactiveEdges", "hoursThreshold", input.HoursThreshold)

	// Calculate threshold timestamp
	threshold := time.Now().Add(-time.Duration(input.HoursThreshold) * time.Hour)
	thresholdStr := threshold.Format(time.RFC3339)

	// Find active edges older than threshold
	query := clients.NewQueryBuilder().
		WhereEquals("isActive", "true").
		Limit(100).
		Build()
	query.Set("where[lastSeen][less_than]", thresholdStr)

	docs, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", query)
	if err != nil {
		return nil, fmt.Errorf("finding stale edges: %w", err)
	}

	markedCount := 0
	for _, edge := range docs {
		edgeID, _ := edge["id"].(string)
		if edgeID == "" {
			continue
		}

		updateData := map[string]any{
			"isActive": false,
		}

		if err := a.payloadClient.Update(ctx, "kafka-lineage-edges", edgeID, updateData); err != nil {
			a.logger.Error("Failed to mark edge inactive", "edgeId", edgeID, "error", err)
			continue
		}
		markedCount++
	}

	return &MarkInactiveEdgesOutput{
		EdgesMarked: markedCount,
	}, nil
}

// CreateDailySnapshots creates daily lineage snapshots for all active topics
func (a *LineageActivitiesImpl) CreateDailySnapshots(ctx context.Context, input CreateDailySnapshotsInput) (*CreateDailySnapshotsOutput, error) {
	a.logger.Info("CreateDailySnapshots", "date", input.Date)

	// Find all active edges grouped by topic
	query := clients.NewQueryBuilder().
		WhereEquals("isActive", "true").
		Limit(500).
		Depth(1). // Populate topic relationship
		Build()

	docs, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", query)
	if err != nil {
		return nil, fmt.Errorf("finding active edges: %w", err)
	}

	// Group edges by topic
	topicEdges := make(map[string][]map[string]any)
	topicWorkspace := make(map[string]string)
	for _, edge := range docs {
		topicID := ""
		if topic, ok := edge["topic"].(map[string]any); ok {
			topicID, _ = topic["id"].(string)
			if ws, ok := topic["workspace"].(string); ok {
				topicWorkspace[topicID] = ws
			}
		} else if tid, ok := edge["topic"].(string); ok {
			topicID = tid
		}
		if topicID != "" {
			topicEdges[topicID] = append(topicEdges[topicID], edge)
		}
	}

	snapshots := 0
	for topicID, edges := range topicEdges {
		// Aggregate producers and consumers
		var producers, consumers []map[string]any
		var totalBytesIn, totalBytesOut, totalMsgsIn, totalMsgsOut int64

		for _, edge := range edges {
			direction, _ := edge["direction"].(string)
			bytes := int64(0)
			if v, ok := edge["bytesLast24h"].(float64); ok {
				bytes = int64(v)
			}
			msgs := int64(0)
			if v, ok := edge["messagesLast24h"].(float64); ok {
				msgs = int64(v)
			}

			sourceApp, _ := edge["sourceApplication"].(string)
			sourceSA, _ := edge["sourceServiceAccount"].(string)
			sourceWS, _ := edge["sourceWorkspace"].(string)

			entry := map[string]any{
				"application":    sourceApp,
				"serviceAccount": sourceSA,
				"workspace":      sourceWS,
				"bytes":          bytes,
				"messages":       msgs,
			}

			if direction == "produce" {
				producers = append(producers, entry)
				totalBytesIn += bytes
				totalMsgsIn += msgs
			} else {
				consumers = append(consumers, entry)
				totalBytesOut += bytes
				totalMsgsOut += msgs
			}
		}

		// Create snapshot record
		snapshotData := map[string]any{
			"topic":             topicID,
			"workspace":         topicWorkspace[topicID],
			"snapshotDate":      input.Date,
			"producers":         producers,
			"consumers":         consumers,
			"totalBytesIn":      totalBytesIn,
			"totalBytesOut":     totalBytesOut,
			"totalMessagesIn":   totalMsgsIn,
			"totalMessagesOut":  totalMsgsOut,
			"producerCount":     len(producers),
			"consumerCount":     len(consumers),
		}

		if _, err := a.payloadClient.Create(ctx, "kafka-lineage-snapshots", snapshotData); err != nil {
			a.logger.Error("Failed to create snapshot", "topicId", topicID, "error", err)
			continue
		}
		snapshots++
	}

	return &CreateDailySnapshotsOutput{
		SnapshotsCreated: snapshots,
	}, nil
}

// Ensure LineageActivitiesImpl implements LineageActivities
var _ LineageActivities = (*LineageActivitiesImpl)(nil)
```

**Step 4: Run tests to verify they pass**

```bash
cd temporal-workflows && go test -v -run "TestProcessActivityBatch|TestResetStale24hMetrics|TestMarkInactiveEdges" ./internal/activities/
```

Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/lineage_activities.go
git add temporal-workflows/internal/activities/lineage_activities_test.go
git commit -m "feat(temporal): implement lineage activities with Payload API calls

- ProcessActivityBatch: resolves virtual cluster, topic, upserts edges
- ResetStale24hMetrics: resets 24h rolling metrics
- MarkInactiveEdges: marks edges inactive after threshold
- CreateDailySnapshots: aggregates edges into daily snapshots
- Add comprehensive unit tests with mock Payload API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Update Worker to Initialize LineageActivities with PayloadClient

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Check current worker initialization**

Look for how other activities using PayloadClient are initialized.

**Step 2: Update worker main.go**

Find the section where `NewLineageActivities` is called and update to pass `payloadClient`:

```go
// Replace:
// lineageActivities := activities.NewLineageActivities(payloadURL, logger)

// With:
lineageActivities := activities.NewLineageActivities(payloadClient, logger)
```

**Step 3: Run worker to verify it compiles**

```bash
cd temporal-workflows && go build -o bin/worker ./cmd/worker
```

Expected: Build succeeds

**Step 4: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "chore(temporal): update worker to pass PayloadClient to lineage activities

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Add Internal API Route for kafka-lineage-edges

**Files:**
- Create: `orbit-www/src/app/api/internal/kafka-lineage-edges/[id]/route.ts`

The PayloadClient uses internal routes for certain collections. Add one for lineage edges.

**Step 1: Create internal API route**

Create `orbit-www/src/app/api/internal/kafka-lineage-edges/[id]/route.ts`:

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'
import { NextRequest, NextResponse } from 'next/server'

const API_KEY = process.env.INTERNAL_API_KEY || 'orbit-internal-key'

function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('X-API-Key')
  return apiKey === API_KEY
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()

  try {
    const payload = await getPayload({ config })
    const result = await payload.update({
      collection: 'kafka-lineage-edges',
      id,
      data: body,
      overrideAccess: true,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Internal API] Error updating lineage edge:', error)
    return NextResponse.json(
      { error: 'Failed to update lineage edge' },
      { status: 500 }
    )
  }
}
```

**Step 2: Update PayloadClient to use internal route for lineage edges**

In `temporal-workflows/internal/clients/payload_client.go`, update the switch statement in `Update()`:

```go
switch collection {
case "kafka-topics", "kafka-virtual-clusters", "kafka-schemas", "kafka-topic-shares", "kafka-lineage-edges":
    reqURL = fmt.Sprintf("%s/api/internal/%s/%s", c.baseURL, collection, id)
```

**Step 3: Commit**

```bash
git add orbit-www/src/app/api/internal/kafka-lineage-edges/
git add temporal-workflows/internal/clients/payload_client.go
git commit -m "feat: add internal API route for kafka-lineage-edges

- Add PATCH endpoint with overrideAccess
- Update PayloadClient to use internal route for lineage edges

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Update TODO.md

**Files:**
- Modify: `docs/TODO.md`

**Step 1: Update TODO.md to mark items complete**

Mark the following as complete:
- Bifrost Callback Client items
- Lineage activity items

**Step 2: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: update TODO.md - Bifrost callback and lineage activities complete

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification

After completing all tasks:

1. **Build Bifrost**: `cd gateway/bifrost && ./gradlew build`
2. **Run Temporal tests**: `cd temporal-workflows && go test ./internal/activities/...`
3. **Start services**: `make dev`
4. **Test end-to-end**:
   - Create a topic via UI
   - Produce/consume messages via Bifrost
   - Check that lineage edges appear in Payload admin

---

## File Summary

### New Files (3)
- `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/callback/BifrostCallbackClientTest.kt`
- `temporal-workflows/internal/activities/lineage_activities_test.go`
- `orbit-www/src/app/api/internal/kafka-lineage-edges/[id]/route.ts`

### Modified Files (4)
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/callback/BifrostCallbackClient.kt`
- `temporal-workflows/internal/activities/lineage_activities.go`
- `temporal-workflows/cmd/worker/main.go`
- `temporal-workflows/internal/clients/payload_client.go`

### Updated Docs (1)
- `docs/TODO.md`
