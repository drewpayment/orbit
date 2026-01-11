// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/AdminServer.kt
package io.orbit.bifrost.admin

import io.grpc.Server
import io.grpc.ServerBuilder
import io.orbit.bifrost.acl.ACLStore
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.policy.PolicyStore
import mu.KotlinLogging
import java.util.concurrent.TimeUnit

private val logger = KotlinLogging.logger {}

class AdminServer(
    private val port: Int,
    private val virtualClusterStore: VirtualClusterStore,
    private val credentialStore: CredentialStore,
    private val policyStore: PolicyStore,
    private val aclStore: ACLStore
) {
    private var server: Server? = null

    fun start() {
        server = ServerBuilder.forPort(port)
            .addService(BifrostAdminServiceImpl(virtualClusterStore, credentialStore, policyStore, aclStore))
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
