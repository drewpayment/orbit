// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt
package io.orbit.bifrost.admin

import io.orbit.bifrost.config.VirtualClusterStore
import idp.gateway.v1.*
import idp.gateway.v1.BifrostAdminServiceGrpcKt
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

class BifrostAdminServiceImpl(
    private val store: VirtualClusterStore
) : BifrostAdminServiceGrpcKt.BifrostAdminServiceCoroutineImplBase() {

    override suspend fun upsertVirtualCluster(
        request: Gateway.UpsertVirtualClusterRequest
    ): Gateway.UpsertVirtualClusterResponse {
        logger.info { "UpsertVirtualCluster: ${request.config.id}" }
        store.upsert(request.config)
        return Gateway.UpsertVirtualClusterResponse.newBuilder()
            .setSuccess(true)
            .build()
    }

    override suspend fun deleteVirtualCluster(
        request: Gateway.DeleteVirtualClusterRequest
    ): Gateway.DeleteVirtualClusterResponse {
        logger.info { "DeleteVirtualCluster: ${request.virtualClusterId}" }
        val success = store.delete(request.virtualClusterId)
        return Gateway.DeleteVirtualClusterResponse.newBuilder()
            .setSuccess(success)
            .build()
    }

    override suspend fun setVirtualClusterReadOnly(
        request: Gateway.SetVirtualClusterReadOnlyRequest
    ): Gateway.SetVirtualClusterReadOnlyResponse {
        logger.info { "SetVirtualClusterReadOnly: ${request.virtualClusterId} = ${request.readOnly}" }
        val existing = store.get(request.virtualClusterId)
        if (existing != null) {
            val updated = existing.toBuilder()
                .setReadOnly(request.readOnly)
                .build()
            store.upsert(updated)
        }
        return Gateway.SetVirtualClusterReadOnlyResponse.newBuilder()
            .setSuccess(existing != null)
            .build()
    }

    override suspend fun getFullConfig(
        request: Gateway.GetFullConfigRequest
    ): Gateway.GetFullConfigResponse {
        logger.info { "GetFullConfig requested" }
        return Gateway.GetFullConfigResponse.newBuilder()
            .addAllVirtualClusters(store.getAll())
            .build()
    }

    override suspend fun getStatus(
        request: Gateway.GetStatusRequest
    ): Gateway.GetStatusResponse {
        return Gateway.GetStatusResponse.newBuilder()
            .setStatus("healthy")
            .setActiveConnections(0) // TODO: Track actual connections
            .setVirtualClusterCount(store.count())
            .putVersionInfo("version", "0.1.0")
            .putVersionInfo("kotlin", System.getProperty("kotlin.version") ?: "unknown")
            .build()
    }

    override suspend fun listVirtualClusters(
        request: Gateway.ListVirtualClustersRequest
    ): Gateway.ListVirtualClustersResponse {
        return Gateway.ListVirtualClustersResponse.newBuilder()
            .addAllVirtualClusters(store.getAll())
            .build()
    }
}
