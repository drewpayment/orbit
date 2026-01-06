// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/auth/Credential.kt
package io.orbit.bifrost.auth

/**
 * Represents a service account credential for authentication.
 */
data class Credential(
    val id: String,
    val virtualClusterId: String,
    val username: String,
    val passwordHash: String,
    val permissionTemplate: PermissionTemplate,
    val customPermissions: List<CustomPermission> = emptyList()
)

enum class PermissionTemplate {
    PRODUCER,
    CONSUMER,
    ADMIN,
    CUSTOM
}

data class CustomPermission(
    val resourceType: String,  // topic, group, transactional_id
    val resourcePattern: String,  // regex or literal
    val operations: Set<String>  // read, write, create, delete, alter
)
