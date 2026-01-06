// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/Application.kt
package io.orbit.bifrost

import io.orbit.bifrost.admin.AdminServer
import io.orbit.bifrost.config.VirtualClusterStore
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

fun main(args: Array<String>) {
    val adminPort = System.getenv("BIFROST_ADMIN_PORT")?.toIntOrNull() ?: 50060

    logger.info { "Bifrost Gateway starting..." }

    val store = VirtualClusterStore()
    val adminServer = AdminServer(adminPort, store)

    adminServer.start()

    logger.info { "Bifrost Gateway started - Admin API on port $adminPort" }

    adminServer.blockUntilShutdown()
}
