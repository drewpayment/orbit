// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/ACLStore.kt
package io.orbit.bifrost.acl

import mu.KotlinLogging
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}

/**
 * Thread-safe in-memory store for ACL entries that enable cross-application topic sharing.
 * ACLs are synced from the Orbit control plane and used to authorize access to topics
 * that belong to different virtual clusters.
 *
 * Thread safety is ensured via:
 * - ConcurrentHashMap for atomic single-key operations
 * - @Synchronized on compound operations (upsert, revoke, clear) to ensure atomicity
 *
 * Supports efficient lookups by:
 * - ACL ID (for management operations)
 * - Credential ID (for authorization checks during authentication)
 * - Topic physical name (for auditing and discovery)
 */
class ACLStore {
    // Primary index by ACL ID
    private val byId = ConcurrentHashMap<String, ACLEntry>()
    // Secondary index: credential ID -> set of ACL IDs
    private val byCredential = ConcurrentHashMap<String, MutableSet<String>>()
    // Secondary index: topic physical name -> set of ACL IDs
    private val byTopic = ConcurrentHashMap<String, MutableSet<String>>()

    /**
     * Insert or update an ACL entry in the store.
     * If the entry already exists, it will be replaced and indexes updated accordingly.
     *
     * This method is synchronized to ensure atomicity of the compound operation
     * (updating the ID index and both secondary indexes).
     */
    @Synchronized
    fun upsert(entry: ACLEntry) {
        // Remove old entry from indexes if exists (handles credential/topic changes)
        byId[entry.id]?.let { old ->
            byCredential[old.credentialId]?.remove(old.id)
            byTopic[old.topicPhysicalName]?.remove(old.id)
        }

        // Add new entry to all indexes
        byId[entry.id] = entry
        byCredential.getOrPut(entry.credentialId) { ConcurrentHashMap.newKeySet() }.add(entry.id)
        byTopic.getOrPut(entry.topicPhysicalName) { ConcurrentHashMap.newKeySet() }.add(entry.id)

        logger.info { "Upserted ACL: ${entry.id} for credential ${entry.credentialId} on topic ${entry.topicPhysicalName}" }
    }

    /**
     * Revoke (remove) an ACL entry by its ID.
     * Returns true if the entry was found and removed, false otherwise.
     *
     * This method is synchronized to ensure atomicity of the compound operation
     * (removing from all indexes).
     */
    @Synchronized
    fun revoke(aclId: String): Boolean {
        val entry = byId.remove(aclId) ?: return false
        byCredential[entry.credentialId]?.remove(aclId)
        byTopic[entry.topicPhysicalName]?.remove(aclId)
        logger.info { "Revoked ACL: $aclId for credential ${entry.credentialId} on topic ${entry.topicPhysicalName}" }
        return true
    }

    /**
     * Get an ACL entry by its ID.
     * Returns null if not found. Does not filter expired entries.
     */
    fun getById(id: String): ACLEntry? = byId[id]

    /**
     * Get all valid (non-expired) ACL entries for a credential.
     * Returns an empty list if no entries exist or all are expired.
     */
    fun getByCredential(credentialId: String): List<ACLEntry> {
        return byCredential[credentialId]
            ?.mapNotNull { byId[it] }
            ?.filter { !it.isExpired() }
            ?: emptyList()
    }

    /**
     * Get all valid (non-expired) ACL entries for a topic.
     * Returns an empty list if no entries exist or all are expired.
     */
    fun getByTopic(topicPhysicalName: String): List<ACLEntry> {
        return byTopic[topicPhysicalName]
            ?.mapNotNull { byId[it] }
            ?.filter { !it.isExpired() }
            ?: emptyList()
    }

    /**
     * Check if a credential has a specific permission on a topic.
     * Returns false if no valid ACL exists, the entry is expired, or
     * the permission is not granted.
     */
    fun hasPermission(credentialId: String, topicPhysicalName: String, permission: String): Boolean {
        val aclIds = byCredential[credentialId] ?: return false
        return aclIds.any { aclId ->
            byId[aclId]?.let { entry ->
                entry.topicPhysicalName == topicPhysicalName && entry.hasPermission(permission)
            } ?: false
        }
    }

    /**
     * Get all ACL entries in the store (including expired ones).
     */
    fun getAll(): List<ACLEntry> = byId.values.toList()

    /**
     * Get the number of ACL entries in the store (including expired ones).
     */
    fun count(): Int = byId.size

    /**
     * Clear all ACL entries from the store.
     */
    @Synchronized
    fun clear() {
        byId.clear()
        byCredential.clear()
        byTopic.clear()
        logger.info { "Cleared all ACL entries" }
    }
}
