package io.orbit.bifrost.callback

import com.google.protobuf.Timestamp
import idp.gateway.v1.BifrostCallbackServiceGrpc
import idp.gateway.v1.Gateway.ClientActivityRecord
import idp.gateway.v1.Gateway.EmitClientActivityRequest
import io.grpc.ManagedChannel
import io.grpc.ManagedChannelBuilder
import mu.KotlinLogging
import java.util.concurrent.TimeUnit

private val logger = KotlinLogging.logger {}

/**
 * Client for calling Orbit's BifrostCallbackService.
 *
 * This client is used to report activity data from the gateway back to Orbit
 * for lineage tracking and observability.
 *
 * The implementation uses gRPC to call the BifrostCallbackService defined in
 * proto/idp/gateway/v1/gateway.proto.
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
     * Gracefully shuts down the client and releases resources.
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
 * This implementation sends client activity records to Orbit's BifrostCallbackService
 * via gRPC for lineage tracking.
 */
class GrpcBifrostCallbackClient private constructor(
    private val channel: ManagedChannel,
    private val stub: BifrostCallbackServiceGrpc.BifrostCallbackServiceBlockingStub,
    private val ownsChannel: Boolean
) : BifrostCallbackClient {

    /**
     * Creates a new client connecting to the specified host and port.
     *
     * @param host Orbit callback service host
     * @param port Orbit callback service port
     */
    constructor(host: String, port: Int) : this(
        channel = ManagedChannelBuilder.forAddress(host, port)
            .usePlaintext()
            .build(),
        ownsChannel = true
    )

    /**
     * Creates a new client using an existing channel (for testing).
     *
     * @param channel Pre-configured ManagedChannel
     */
    constructor(channel: ManagedChannel) : this(
        channel = channel,
        ownsChannel = false
    )

    private constructor(channel: ManagedChannel, ownsChannel: Boolean) : this(
        channel = channel,
        stub = BifrostCallbackServiceGrpc.newBlockingStub(channel),
        ownsChannel = ownsChannel
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
                .setConsumerGroupId(record.consumerGroupId ?: "")
                .setBytes(record.bytes)
                .setMessageCount(record.messageCount)
                .setWindowStart(record.windowStart.toProtoTimestamp())
                .setWindowEnd(record.windowEnd.toProtoTimestamp())
                .build()
        }

        val request = EmitClientActivityRequest.newBuilder()
            .addAllRecords(protoRecords)
            .build()

        try {
            val response = stub.emitClientActivity(request)
            logger.debug {
                "Activity emission completed: success=${response.success}, " +
                    "recordsProcessed=${response.recordsProcessed}"
            }
        } catch (e: Exception) {
            logger.error(e) { "Failed to emit client activity records" }
            throw e
        }
    }

    override fun shutdown() {
        if (ownsChannel) {
            logger.info { "Shutting down BifrostCallbackClient channel" }
            channel.shutdown().awaitTermination(5, TimeUnit.SECONDS)
        }
    }

    private fun java.time.Instant.toProtoTimestamp(): Timestamp {
        return Timestamp.newBuilder()
            .setSeconds(this.epochSecond)
            .setNanos(this.nano)
            .build()
    }
}
