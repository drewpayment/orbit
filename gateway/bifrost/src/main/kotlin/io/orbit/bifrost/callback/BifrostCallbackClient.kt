package io.orbit.bifrost.callback

import mu.KotlinLogging

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
}

/**
 * No-op implementation for testing or when callback is disabled.
 */
class NoOpBifrostCallbackClient : BifrostCallbackClient {
    override fun emitClientActivity(records: List<ActivityRecord>) {
        logger.debug { "NoOp callback client: would emit ${records.size} activity records" }
    }
}

/**
 * gRPC implementation of BifrostCallbackClient.
 *
 * This implementation will be fully functional once the EmitClientActivity RPC
 * is added to the proto definitions (Task 5).
 *
 * @param host Orbit callback service host
 * @param port Orbit callback service port
 */
class GrpcBifrostCallbackClient(
    private val host: String,
    private val port: Int
) : BifrostCallbackClient {

    // TODO: Initialize gRPC channel and stub once proto messages are generated
    // private val channel = ManagedChannelBuilder.forAddress(host, port).usePlaintext().build()
    // private val stub = BifrostCallbackServiceGrpc.newBlockingStub(channel)

    override fun emitClientActivity(records: List<ActivityRecord>) {
        if (records.isEmpty()) {
            return
        }

        logger.info { "Emitting ${records.size} activity records to Orbit at $host:$port" }

        // TODO: Convert ActivityRecord to proto messages and call RPC
        // This will be implemented after Task 5 (proto messages)
        //
        // val request = EmitClientActivityRequest.newBuilder()
        //     .addAllRecords(records.map { record ->
        //         ClientActivityRecord.newBuilder()
        //             .setVirtualClusterId(record.virtualClusterId)
        //             .setServiceAccountId(record.serviceAccountId)
        //             .setTopicVirtualName(record.topicVirtualName)
        //             .setDirection(record.direction)
        //             .setConsumerGroupId(record.consumerGroupId ?: "")
        //             .setBytes(record.bytes)
        //             .setMessageCount(record.messageCount)
        //             .setWindowStart(Timestamps.fromMillis(record.windowStart.toEpochMilli()))
        //             .setWindowEnd(Timestamps.fromMillis(record.windowEnd.toEpochMilli()))
        //             .build()
        //     })
        //     .build()
        //
        // stub.emitClientActivity(request)

        // For now, just log the activity (will be replaced with actual gRPC call)
        records.forEach { record ->
            logger.debug {
                "Activity: vCluster=${record.virtualClusterId}, " +
                    "topic=${record.topicVirtualName}, " +
                    "direction=${record.direction}, " +
                    "bytes=${record.bytes}, " +
                    "messages=${record.messageCount}"
            }
        }
    }

    fun shutdown() {
        // TODO: Shutdown gRPC channel
        // channel.shutdown().awaitTermination(5, TimeUnit.SECONDS)
    }
}
