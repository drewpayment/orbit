// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/auth/CredentialStore.kt
package io.orbit.bifrost.auth

import mu.KotlinLogging
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}

/**
 * Thread-safe in-memory store for service account credentials.
 * Supports hot-reload via gRPC Admin API.
 */
class CredentialStore {
    // Index by username for fast lookup during auth
    private val byUsername = ConcurrentHashMap<String, Credential>()
    // Index by ID for management operations
    private val byId = ConcurrentHashMap<String, Credential>()
    // Index by virtual cluster for listing
    private val byVirtualCluster = ConcurrentHashMap<String, MutableSet<String>>()

    fun upsert(credential: Credential) {
        // Remove old entry if username changed
        byId[credential.id]?.let { old ->
            if (old.username != credential.username) {
                byUsername.remove(old.username)
            }
            byVirtualCluster[old.virtualClusterId]?.remove(old.id)
        }

        byId[credential.id] = credential
        byUsername[credential.username] = credential
        byVirtualCluster.computeIfAbsent(credential.virtualClusterId) {
            ConcurrentHashMap.newKeySet()
        }.add(credential.id)

        logger.info { "Upserted credential: ${credential.username} (${credential.id})" }
    }

    fun revoke(credentialId: String): Boolean {
        val credential = byId.remove(credentialId) ?: return false
        byUsername.remove(credential.username)
        byVirtualCluster[credential.virtualClusterId]?.remove(credentialId)
        logger.info { "Revoked credential: ${credential.username} (${credential.id})" }
        return true
    }

    fun authenticate(username: String, password: String): Credential? {
        val credential = byUsername[username] ?: return null

        // Verify password hash
        val inputHash = hashPassword(password)
        if (inputHash != credential.passwordHash) {
            logger.warn { "Authentication failed for user: $username (invalid password)" }
            return null
        }

        logger.debug { "Authentication successful for user: $username" }
        return credential
    }

    fun getByUsername(username: String): Credential? = byUsername[username]

    fun getById(id: String): Credential? = byId[id]

    fun getByVirtualCluster(virtualClusterId: String): List<Credential> {
        val ids = byVirtualCluster[virtualClusterId] ?: return emptyList()
        return ids.mapNotNull { byId[it] }
    }

    fun getAll(): List<Credential> = byId.values.toList()

    fun count(): Int = byId.size

    fun clear() {
        byId.clear()
        byUsername.clear()
        byVirtualCluster.clear()
        logger.info { "Cleared all credentials" }
    }

    companion object {
        fun hashPassword(password: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(password.toByteArray(Charsets.UTF_8))
            return hash.joinToString("") { "%02x".format(it) }
        }
    }
}
