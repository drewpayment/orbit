// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/FilterContext.kt
package io.orbit.bifrost.filter

import idp.gateway.v1.Gateway.VirtualClusterConfig

/**
 * Context passed through the filter chain for each request.
 * Contains tenant information resolved from SNI or authentication,
 * plus request-specific correlation information.
 */
data class FilterContext(
    val virtualCluster: VirtualClusterConfig?,
    val credentialId: String? = null,
    val username: String? = null,
    val permissions: Set<String> = emptySet(),
    val isAuthenticated: Boolean = false,
    /**
     * Kafka protocol correlation ID for this request/response pair.
     * This ID is set by the client and returned in the response header,
     * enabling accurate request/response correlation across async boundaries.
     */
    val correlationId: Int = 0
) {
    val topicPrefix: String get() = virtualCluster?.topicPrefix ?: ""
    val groupPrefix: String get() = virtualCluster?.groupPrefix ?: ""
    val transactionIdPrefix: String get() = virtualCluster?.transactionIdPrefix ?: ""
    val isReadOnly: Boolean get() = virtualCluster?.readOnly ?: false
}
