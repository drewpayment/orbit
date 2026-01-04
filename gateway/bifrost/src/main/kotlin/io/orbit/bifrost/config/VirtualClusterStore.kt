// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/config/VirtualClusterStore.kt
package io.orbit.bifrost.config

import idp.gateway.v1.Gateway.VirtualClusterConfig
import mu.KotlinLogging
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}

/**
 * Thread-safe in-memory store for virtual cluster configurations.
 * Updated via gRPC Admin API.
 */
class VirtualClusterStore {
    private val clusters = ConcurrentHashMap<String, VirtualClusterConfig>()

    fun upsert(config: VirtualClusterConfig) {
        clusters[config.id] = config
        logger.info { "Upserted virtual cluster: ${config.id} (${config.advertisedHost})" }
    }

    fun delete(id: String): Boolean {
        val removed = clusters.remove(id)
        if (removed != null) {
            logger.info { "Deleted virtual cluster: $id" }
        }
        return removed != null
    }

    fun get(id: String): VirtualClusterConfig? = clusters[id]

    fun getByHost(host: String): VirtualClusterConfig? {
        return clusters.values.find { it.advertisedHost == host }
    }

    fun getAll(): List<VirtualClusterConfig> = clusters.values.toList()

    fun count(): Int = clusters.size

    fun clear() {
        clusters.clear()
        logger.info { "Cleared all virtual clusters" }
    }
}
