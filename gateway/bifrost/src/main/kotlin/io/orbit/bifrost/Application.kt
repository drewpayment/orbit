// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/Application.kt
package io.orbit.bifrost

import io.orbit.bifrost.admin.AdminServer
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.filter.AuthenticationFilter
import io.orbit.bifrost.filter.FilterChain
import io.orbit.bifrost.filter.GroupRewriteFilter
import io.orbit.bifrost.filter.PolicyEnforcementFilter
import io.orbit.bifrost.filter.TopicRewriteFilter
import io.orbit.bifrost.filter.TransactionRewriteFilter
import io.orbit.bifrost.policy.PolicyStore
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

fun main(args: Array<String>) {
    val adminPort = System.getenv("BIFROST_ADMIN_PORT")?.toIntOrNull() ?: 50060

    logger.info { "Bifrost Gateway starting..." }

    // Create stores
    val virtualClusterStore = VirtualClusterStore()
    val credentialStore = CredentialStore()
    val policyStore = PolicyStore()

    // Build filter chain with all filters in correct order
    // Note: filterChain will be used when Kroxylicious integration is added
    val filterChain = FilterChain.builder()
        .addFilter(AuthenticationFilter(credentialStore, virtualClusterStore))
        .addFilter(PolicyEnforcementFilter(policyStore))
        .addFilter(TopicRewriteFilter())
        .addFilter(GroupRewriteFilter())
        .addFilter(TransactionRewriteFilter())
        .build()

    logger.info { "Filter chain initialized with ${filterChain.javaClass.simpleName}" }

    // Create admin server with all stores
    val adminServer = AdminServer(adminPort, virtualClusterStore, credentialStore, policyStore)

    adminServer.start()

    logger.info { "Bifrost Gateway started - Admin API on port $adminPort" }

    adminServer.blockUntilShutdown()
}
