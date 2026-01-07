// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/policy/PolicyStore.kt
package io.orbit.bifrost.policy

import mu.KotlinLogging
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

private val logger = KotlinLogging.logger {}

/**
 * Thread-safe in-memory store for topic creation policies.
 * Policies are synced from the Orbit control plane and used to
 * validate topic creation requests in Bifrost.
 *
 * Thread safety is ensured via:
 * - ConcurrentHashMap for atomic single-key operations
 * - CopyOnWriteArrayList for thread-safe environment index
 * - @Synchronized on compound operations (upsert, delete) to ensure atomicity
 */
class PolicyStore {
    private val policiesById = ConcurrentHashMap<String, PolicyConfig>()
    private val policiesByEnvironment = ConcurrentHashMap<String, CopyOnWriteArrayList<PolicyConfig>>()

    /**
     * Insert or update a policy in the store.
     * If the policy already exists, it will be replaced.
     * Environment index is updated accordingly.
     *
     * This method is synchronized to ensure atomicity of the compound operation
     * (updating both the ID index and environment index).
     */
    @Synchronized
    fun upsert(policy: PolicyConfig) {
        val existing = policiesById.put(policy.id, policy)

        // Update environment index
        if (existing != null && existing.environment != policy.environment) {
            policiesByEnvironment[existing.environment]?.removeIf { it.id == policy.id }
        }
        policiesByEnvironment.computeIfAbsent(policy.environment) { CopyOnWriteArrayList() }
            .apply {
                removeIf { it.id == policy.id }
                add(policy)
            }

        logger.info { "Upserted policy: ${policy.id} for environment: ${policy.environment}" }
    }

    /**
     * Delete a policy from the store by its ID.
     *
     * This method is synchronized to ensure atomicity of the compound operation
     * (removing from both the ID index and environment index).
     */
    @Synchronized
    fun delete(policyId: String) {
        val removed = policiesById.remove(policyId)
        if (removed != null) {
            policiesByEnvironment[removed.environment]?.removeIf { it.id == policyId }
            logger.info { "Deleted policy: $policyId" }
        }
    }

    /**
     * Get a policy by its ID.
     * Returns null if not found.
     */
    fun getById(policyId: String): PolicyConfig? = policiesById[policyId]

    /**
     * Get all policies for a specific environment.
     * Returns an empty list if no policies exist for the environment.
     */
    fun getByEnvironment(environment: String): List<PolicyConfig> =
        policiesByEnvironment[environment]?.toList() ?: emptyList()

    /**
     * Get all policies in the store.
     */
    fun getAll(): List<PolicyConfig> = policiesById.values.toList()

    /**
     * Clear all policies from the store.
     */
    fun clear() {
        policiesById.clear()
        policiesByEnvironment.clear()
        logger.info { "Cleared all policies" }
    }

    /**
     * Get the number of policies in the store.
     */
    fun count(): Int = policiesById.size
}
