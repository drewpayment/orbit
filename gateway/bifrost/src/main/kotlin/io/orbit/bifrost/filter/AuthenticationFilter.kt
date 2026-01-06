// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/AuthenticationFilter.kt
package io.orbit.bifrost.filter

import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.auth.PermissionTemplate
import io.orbit.bifrost.config.VirtualClusterStore
import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.*

private val logger = KotlinLogging.logger {}

/**
 * Handles SASL/PLAIN authentication.
 * Validates credentials and attaches tenant context to the connection.
 */
class AuthenticationFilter(
    private val credentialStore: CredentialStore,
    private val virtualClusterStore: VirtualClusterStore
) : BifrostFilter {
    override val name = "AuthenticationFilter"
    override val order = 0  // Must run first

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        // API version requests are allowed without auth (for client negotiation)
        if (apiKey.toInt() == ApiKeys.API_VERSIONS.id) {
            return FilterResult.Pass(request)
        }

        // SASL handshake and authenticate are handled specially
        if (apiKey.toInt() == ApiKeys.SASL_HANDSHAKE.id) {
            return FilterResult.Pass(request)
        }

        if (apiKey.toInt() == ApiKeys.SASL_AUTHENTICATE.id) {
            return handleSaslAuthenticate(request as SaslAuthenticateRequest)
        }

        // All other requests require authentication
        if (!context.isAuthenticated) {
            return FilterResult.Reject(
                errorCode = 58, // SASL_AUTHENTICATION_FAILED
                message = "Not authenticated"
            )
        }

        // Check permissions for write operations
        if (isWriteOperation(apiKey) && !hasWritePermission(context)) {
            return FilterResult.Reject(
                errorCode = 29, // CLUSTER_AUTHORIZATION_FAILED
                message = "Insufficient permissions for write operation"
            )
        }

        return FilterResult.Pass(request)
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }

    private fun handleSaslAuthenticate(
        request: SaslAuthenticateRequest
    ): FilterResult<AbstractRequest> {
        val authBytes = request.data().authBytes()
        val credentials = parseSaslPlain(authBytes)

        if (credentials == null) {
            logger.warn { "Invalid SASL/PLAIN format" }
            return FilterResult.Reject(
                errorCode = 58,
                message = "Invalid SASL/PLAIN format"
            )
        }

        val (username, password) = credentials
        val credential = credentialStore.authenticate(username, password)

        if (credential == null) {
            logger.warn { "Authentication failed for user: $username" }
            return FilterResult.Reject(
                errorCode = 58,
                message = "Authentication failed"
            )
        }

        logger.info { "Authenticated user: $username for virtual cluster: ${credential.virtualClusterId}" }

        // The actual context update happens at the connection level
        // This filter just validates the credentials
        return FilterResult.Pass(request)
    }

    private fun parseSaslPlain(authBytes: ByteArray): Pair<String, String>? {
        // SASL/PLAIN format: authzid NUL authcid NUL passwd
        val parts = String(authBytes, Charsets.UTF_8).split('\u0000')
        if (parts.size != 3) return null

        val authcid = parts[1]  // Username
        val passwd = parts[2]   // Password

        return Pair(authcid, passwd)
    }

    private fun isWriteOperation(apiKey: Short): Boolean {
        return when (apiKey.toInt()) {
            ApiKeys.PRODUCE.id,
            ApiKeys.CREATE_TOPICS.id,
            ApiKeys.DELETE_TOPICS.id,
            ApiKeys.DELETE_RECORDS.id,
            ApiKeys.ALTER_CONFIGS.id,
            ApiKeys.DELETE_GROUPS.id,
            ApiKeys.INIT_PRODUCER_ID.id,
            ApiKeys.ADD_PARTITIONS_TO_TXN.id,
            ApiKeys.END_TXN.id -> true
            else -> false
        }
    }

    private fun hasWritePermission(context: FilterContext): Boolean {
        // Check based on permission template or custom permissions
        return context.permissions.any { it in setOf("write", "produce", "admin", "all") }
    }
}

/**
 * Extension to get permissions from permission template.
 */
fun PermissionTemplate.toPermissions(): Set<String> {
    return when (this) {
        PermissionTemplate.PRODUCER -> setOf("write", "produce", "describe")
        PermissionTemplate.CONSUMER -> setOf("read", "consume", "describe")
        PermissionTemplate.ADMIN -> setOf("read", "write", "produce", "consume", "create", "delete", "alter", "describe", "admin")
        PermissionTemplate.CUSTOM -> emptySet()  // Use custom permissions
    }
}
