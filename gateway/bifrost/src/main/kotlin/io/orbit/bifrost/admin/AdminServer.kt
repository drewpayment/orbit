// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/AdminServer.kt
package io.orbit.bifrost.admin

import io.grpc.Server
import io.grpc.ServerBuilder
import io.orbit.bifrost.config.VirtualClusterStore
import mu.KotlinLogging
import java.util.concurrent.TimeUnit

private val logger = KotlinLogging.logger {}

class AdminServer(
    private val port: Int,
    private val store: VirtualClusterStore
) {
    private var server: Server? = null

    fun start() {
        server = ServerBuilder.forPort(port)
            .addService(BifrostAdminServiceImpl(store))
            .build()
            .start()

        logger.info { "Admin gRPC server started on port $port" }

        Runtime.getRuntime().addShutdownHook(Thread {
            logger.info { "Shutting down admin server..." }
            stop()
        })
    }

    fun stop() {
        server?.shutdown()?.awaitTermination(30, TimeUnit.SECONDS)
    }

    fun blockUntilShutdown() {
        server?.awaitTermination()
    }
}
