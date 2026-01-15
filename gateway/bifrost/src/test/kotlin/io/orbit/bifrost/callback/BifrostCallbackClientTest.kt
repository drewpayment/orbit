// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/callback/BifrostCallbackClientTest.kt
package io.orbit.bifrost.callback

import com.google.protobuf.util.Timestamps
import idp.gateway.v1.BifrostCallbackServiceGrpc
import idp.gateway.v1.Gateway.ClientActivityRecord
import idp.gateway.v1.Gateway.EmitClientActivityRequest
import idp.gateway.v1.Gateway.EmitClientActivityResponse
import io.grpc.ManagedChannel
import io.grpc.inprocess.InProcessChannelBuilder
import io.grpc.inprocess.InProcessServerBuilder
import io.grpc.stub.StreamObserver
import io.grpc.testing.GrpcCleanupRule
import org.junit.Rule
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BifrostCallbackClientTest {

    @get:Rule
    val grpcCleanup = GrpcCleanupRule()

    private lateinit var serverName: String
    private lateinit var channel: ManagedChannel
    private lateinit var client: GrpcBifrostCallbackClient
    private lateinit var capturedRequests: MutableList<EmitClientActivityRequest>
    private lateinit var mockService: MockBifrostCallbackService

    @BeforeEach
    fun setup() {
        serverName = InProcessServerBuilder.generateName()
        capturedRequests = CopyOnWriteArrayList()
        mockService = MockBifrostCallbackService(capturedRequests)

        // Start in-process gRPC server
        grpcCleanup.register(
            InProcessServerBuilder.forName(serverName)
                .directExecutor()
                .addService(mockService)
                .build()
                .start()
        )

        // Create channel and client
        channel = grpcCleanup.register(
            InProcessChannelBuilder.forName(serverName)
                .directExecutor()
                .build()
        )
        client = GrpcBifrostCallbackClient(channel)
    }

    @AfterEach
    fun teardown() {
        client.shutdown()
    }

    @Test
    fun `emitClientActivity sends records via gRPC`() {
        val windowStart = Instant.parse("2024-01-15T10:00:00Z")
        val windowEnd = Instant.parse("2024-01-15T10:01:00Z")

        val records = listOf(
            ActivityRecord(
                virtualClusterId = "vc-123",
                serviceAccountId = "sa-456",
                topicVirtualName = "orders",
                direction = "produce",
                consumerGroupId = null,
                bytes = 1024,
                messageCount = 10,
                windowStart = windowStart,
                windowEnd = windowEnd
            )
        )

        client.emitClientActivity(records)

        assertEquals(1, capturedRequests.size)
        val request = capturedRequests[0]
        assertEquals(1, request.recordsCount)

        val protoRecord = request.recordsList[0]
        assertEquals("vc-123", protoRecord.virtualClusterId)
        assertEquals("sa-456", protoRecord.serviceAccountId)
        assertEquals("orders", protoRecord.topicVirtualName)
        assertEquals("produce", protoRecord.direction)
        assertEquals("", protoRecord.consumerGroupId)
        assertEquals(1024, protoRecord.bytes)
        assertEquals(10, protoRecord.messageCount)
        assertEquals(windowStart.epochSecond, protoRecord.windowStart.seconds)
        assertEquals(windowStart.nano, protoRecord.windowStart.nanos)
        assertEquals(windowEnd.epochSecond, protoRecord.windowEnd.seconds)
        assertEquals(windowEnd.nano, protoRecord.windowEnd.nanos)
    }

    @Test
    fun `emitClientActivity handles empty list`() {
        client.emitClientActivity(emptyList())

        // Should not make any RPC call for empty list
        assertTrue(capturedRequests.isEmpty())
    }

    @Test
    fun `emitClientActivity includes consumer group for consume direction`() {
        val windowStart = Instant.parse("2024-01-15T10:00:00Z")
        val windowEnd = Instant.parse("2024-01-15T10:01:00Z")

        val records = listOf(
            ActivityRecord(
                virtualClusterId = "vc-789",
                serviceAccountId = "sa-consumer",
                topicVirtualName = "events",
                direction = "consume",
                consumerGroupId = "my-consumer-group",
                bytes = 2048,
                messageCount = 20,
                windowStart = windowStart,
                windowEnd = windowEnd
            )
        )

        client.emitClientActivity(records)

        assertEquals(1, capturedRequests.size)
        val request = capturedRequests[0]
        assertEquals(1, request.recordsCount)

        val protoRecord = request.recordsList[0]
        assertEquals("consume", protoRecord.direction)
        assertEquals("my-consumer-group", protoRecord.consumerGroupId)
    }

    @Test
    fun `emitClientActivity sends multiple records in single batch`() {
        val windowStart = Instant.parse("2024-01-15T10:00:00Z")
        val windowEnd = Instant.parse("2024-01-15T10:01:00Z")

        val records = listOf(
            ActivityRecord(
                virtualClusterId = "vc-1",
                serviceAccountId = "sa-1",
                topicVirtualName = "topic-a",
                direction = "produce",
                bytes = 100,
                messageCount = 1,
                windowStart = windowStart,
                windowEnd = windowEnd
            ),
            ActivityRecord(
                virtualClusterId = "vc-1",
                serviceAccountId = "sa-2",
                topicVirtualName = "topic-b",
                direction = "consume",
                consumerGroupId = "group-1",
                bytes = 200,
                messageCount = 2,
                windowStart = windowStart,
                windowEnd = windowEnd
            ),
            ActivityRecord(
                virtualClusterId = "vc-2",
                serviceAccountId = "sa-3",
                topicVirtualName = "topic-c",
                direction = "produce",
                bytes = 300,
                messageCount = 3,
                windowStart = windowStart,
                windowEnd = windowEnd
            )
        )

        client.emitClientActivity(records)

        assertEquals(1, capturedRequests.size)
        val request = capturedRequests[0]
        assertEquals(3, request.recordsCount)

        // Verify each record is correctly mapped
        assertEquals("vc-1", request.recordsList[0].virtualClusterId)
        assertEquals("sa-1", request.recordsList[0].serviceAccountId)
        assertEquals("topic-a", request.recordsList[0].topicVirtualName)

        assertEquals("vc-1", request.recordsList[1].virtualClusterId)
        assertEquals("sa-2", request.recordsList[1].serviceAccountId)
        assertEquals("group-1", request.recordsList[1].consumerGroupId)

        assertEquals("vc-2", request.recordsList[2].virtualClusterId)
        assertEquals("sa-3", request.recordsList[2].serviceAccountId)
    }

    @Test
    fun `NoOpBifrostCallbackClient does not throw`() {
        val noOpClient = NoOpBifrostCallbackClient()
        val records = listOf(
            ActivityRecord(
                virtualClusterId = "vc-test",
                serviceAccountId = "sa-test",
                topicVirtualName = "test-topic",
                direction = "produce",
                bytes = 100,
                messageCount = 1,
                windowStart = Instant.now(),
                windowEnd = Instant.now()
            )
        )

        // Should not throw
        noOpClient.emitClientActivity(records)
        noOpClient.shutdown()
    }

    /**
     * Mock implementation of BifrostCallbackService for testing
     */
    private class MockBifrostCallbackService(
        private val capturedRequests: MutableList<EmitClientActivityRequest>
    ) : BifrostCallbackServiceGrpc.BifrostCallbackServiceImplBase() {

        override fun emitClientActivity(
            request: EmitClientActivityRequest,
            responseObserver: StreamObserver<EmitClientActivityResponse>
        ) {
            capturedRequests.add(request)
            responseObserver.onNext(
                EmitClientActivityResponse.newBuilder()
                    .setSuccess(true)
                    .setRecordsProcessed(request.recordsCount)
                    .build()
            )
            responseObserver.onCompleted()
        }
    }
}
