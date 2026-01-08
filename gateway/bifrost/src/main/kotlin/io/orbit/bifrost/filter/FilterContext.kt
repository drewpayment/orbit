// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/FilterContext.kt
package io.orbit.bifrost.filter

import idp.gateway.v1.Gateway.VirtualClusterConfig

/**
 * Context passed through the filter chain for each connection.
 * Contains tenant information resolved from SNI or authentication.
 */
data class FilterContext(
    val virtualCluster: VirtualClusterConfig?,
    val credentialId: String? = null,
    val username: String? = null,
    val permissions: Set<String> = emptySet(),
    val isAuthenticated: Boolean = false
) {
    val topicPrefix: String get() = virtualCluster?.topicPrefix ?: ""
    val groupPrefix: String get() = virtualCluster?.groupPrefix ?: ""
    val transactionIdPrefix: String get() = virtualCluster?.transactionIdPrefix ?: ""
    val isReadOnly: Boolean get() = virtualCluster?.readOnly ?: false
}
