// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/ACLEntry.kt
package io.orbit.bifrost.acl

import java.time.Instant

/**
 * Represents an ACL entry for cross-application topic sharing.
 * Grants a credential permission to access a topic that may belong to
 * a different virtual cluster (application).
 *
 * @property id Unique identifier for this ACL entry (e.g., "share-123")
 * @property credentialId The credential being granted access
 * @property topicPhysicalName The physical topic name in Kafka (e.g., "acme-payments-prod-orders")
 * @property permissions Set of allowed operations (e.g., "read", "write")
 * @property expiresAt Optional expiration timestamp; null means no expiration
 */
data class ACLEntry(
    val id: String,
    val credentialId: String,
    val topicPhysicalName: String,
    val permissions: Set<String>,
    val expiresAt: Instant?
) {
    /**
     * Checks if this ACL entry has expired.
     * An entry with null expiresAt never expires.
     */
    fun isExpired(): Boolean = expiresAt?.isBefore(Instant.now()) ?: false

    /**
     * Checks if this ACL entry grants the specified permission.
     * Returns false if the entry is expired or doesn't include the permission.
     */
    fun hasPermission(permission: String): Boolean = !isExpired() && permissions.contains(permission)
}
