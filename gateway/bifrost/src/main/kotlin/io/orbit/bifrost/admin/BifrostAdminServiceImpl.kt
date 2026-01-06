// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt
package io.orbit.bifrost.admin

import io.orbit.bifrost.auth.Credential
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.auth.CustomPermission
import io.orbit.bifrost.auth.PermissionTemplate
import io.orbit.bifrost.config.VirtualClusterStore
import idp.gateway.v1.*
import idp.gateway.v1.BifrostAdminServiceGrpcKt
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

class BifrostAdminServiceImpl(
    private val store: VirtualClusterStore,
    private val credentialStore: CredentialStore = CredentialStore()
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

    // ========================================================================
    // Credential Management
    // ========================================================================

    override suspend fun upsertCredential(
        request: Gateway.UpsertCredentialRequest
    ): Gateway.UpsertCredentialResponse {
        logger.info { "UpsertCredential: ${request.config.username}" }

        val credential = Credential(
            id = request.config.id,
            virtualClusterId = request.config.virtualClusterId,
            username = request.config.username,
            passwordHash = request.config.passwordHash,
            permissionTemplate = request.config.template.toKotlin(),
            customPermissions = request.config.customPermissionsList.map { it.toKotlin() }
        )

        credentialStore.upsert(credential)

        return Gateway.UpsertCredentialResponse.newBuilder()
            .setSuccess(true)
            .build()
    }

    override suspend fun revokeCredential(
        request: Gateway.RevokeCredentialRequest
    ): Gateway.RevokeCredentialResponse {
        logger.info { "RevokeCredential: ${request.credentialId}" }
        val success = credentialStore.revoke(request.credentialId)
        return Gateway.RevokeCredentialResponse.newBuilder()
            .setSuccess(success)
            .build()
    }

    override suspend fun listCredentials(
        request: Gateway.ListCredentialsRequest
    ): Gateway.ListCredentialsResponse {
        val credentials = if (request.virtualClusterId.isNotEmpty()) {
            credentialStore.getByVirtualCluster(request.virtualClusterId)
        } else {
            credentialStore.getAll()
        }

        return Gateway.ListCredentialsResponse.newBuilder()
            .addAllCredentials(credentials.map { it.toProto() })
            .build()
    }

    // ========================================================================
    // Extension functions for proto conversion
    // ========================================================================

    private fun Gateway.PermissionTemplate.toKotlin(): PermissionTemplate {
        return when (this) {
            Gateway.PermissionTemplate.PERMISSION_TEMPLATE_PRODUCER -> PermissionTemplate.PRODUCER
            Gateway.PermissionTemplate.PERMISSION_TEMPLATE_CONSUMER -> PermissionTemplate.CONSUMER
            Gateway.PermissionTemplate.PERMISSION_TEMPLATE_ADMIN -> PermissionTemplate.ADMIN
            Gateway.PermissionTemplate.PERMISSION_TEMPLATE_CUSTOM -> PermissionTemplate.CUSTOM
            else -> PermissionTemplate.CONSUMER
        }
    }

    private fun Gateway.CustomPermission.toKotlin(): CustomPermission {
        return CustomPermission(
            resourceType = resourceType,
            resourcePattern = resourcePattern,
            operations = operationsList.toSet()
        )
    }

    private fun Credential.toProto(): Gateway.CredentialConfig {
        return Gateway.CredentialConfig.newBuilder()
            .setId(id)
            .setVirtualClusterId(virtualClusterId)
            .setUsername(username)
            .setPasswordHash(passwordHash)
            .setTemplate(permissionTemplate.toProto())
            .addAllCustomPermissions(customPermissions.map { it.toProto() })
            .build()
    }

    private fun PermissionTemplate.toProto(): Gateway.PermissionTemplate {
        return when (this) {
            PermissionTemplate.PRODUCER -> Gateway.PermissionTemplate.PERMISSION_TEMPLATE_PRODUCER
            PermissionTemplate.CONSUMER -> Gateway.PermissionTemplate.PERMISSION_TEMPLATE_CONSUMER
            PermissionTemplate.ADMIN -> Gateway.PermissionTemplate.PERMISSION_TEMPLATE_ADMIN
            PermissionTemplate.CUSTOM -> Gateway.PermissionTemplate.PERMISSION_TEMPLATE_CUSTOM
        }
    }

    private fun CustomPermission.toProto(): Gateway.CustomPermission {
        return Gateway.CustomPermission.newBuilder()
            .setResourceType(resourceType)
            .setResourcePattern(resourcePattern)
            .addAllOperations(operations)
            .build()
    }
}
