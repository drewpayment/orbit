// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt
package io.orbit.bifrost.admin

import com.google.protobuf.Timestamp
import io.orbit.bifrost.acl.ACLEntry
import io.orbit.bifrost.acl.ACLStore
import io.orbit.bifrost.auth.Credential
import io.orbit.bifrost.auth.CredentialStore
import io.orbit.bifrost.auth.CustomPermission
import io.orbit.bifrost.auth.PermissionTemplate
import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.policy.PolicyStore
import io.orbit.bifrost.policy.PolicyConfig as PolicyConfigDomain
import idp.gateway.v1.*
import idp.gateway.v1.BifrostAdminServiceGrpcKt
import mu.KotlinLogging
import java.time.Instant

private val logger = KotlinLogging.logger {}

class BifrostAdminServiceImpl(
    private val store: VirtualClusterStore,
    private val credentialStore: CredentialStore = CredentialStore(),
    private val policyStore: PolicyStore = PolicyStore(),
    private val aclStore: ACLStore = ACLStore()
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
            .addAllCredentials(credentialStore.getAll().map { it.toProto() })
            .addAllPolicies(policyStore.getAll().map { it.toProto() })
            .addAllTopicAcls(aclStore.getAll().map { it.toProto() })
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
    // Policy Management
    // ========================================================================

    override suspend fun upsertPolicy(
        request: Gateway.UpsertPolicyRequest
    ): Gateway.UpsertPolicyResponse {
        logger.info { "UpsertPolicy: ${request.config.id}" }

        val policy = request.config.toDomain()
        policyStore.upsert(policy)

        return Gateway.UpsertPolicyResponse.newBuilder()
            .setSuccess(true)
            .build()
    }

    override suspend fun deletePolicy(
        request: Gateway.DeletePolicyRequest
    ): Gateway.DeletePolicyResponse {
        logger.info { "DeletePolicy: ${request.policyId}" }
        policyStore.delete(request.policyId)
        return Gateway.DeletePolicyResponse.newBuilder()
            .setSuccess(true)
            .build()
    }

    override suspend fun listPolicies(
        request: Gateway.ListPoliciesRequest
    ): Gateway.ListPoliciesResponse {
        val policies = if (request.environment.isNotEmpty()) {
            policyStore.getByEnvironment(request.environment)
        } else {
            policyStore.getAll()
        }

        return Gateway.ListPoliciesResponse.newBuilder()
            .addAllPolicies(policies.map { it.toProto() })
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

    // ========================================================================
    // PolicyConfig conversion functions
    // ========================================================================

    private fun Gateway.PolicyConfig.toDomain(): PolicyConfigDomain {
        return PolicyConfigDomain(
            id = id,
            environment = environment,
            maxPartitions = maxPartitions,
            minPartitions = minPartitions,
            maxRetentionMs = maxRetentionMs,
            minReplicationFactor = minReplicationFactor,
            allowedCleanupPolicies = allowedCleanupPoliciesList.toList(),
            namingPattern = namingPattern,
            maxNameLength = maxNameLength
        )
    }

    private fun PolicyConfigDomain.toProto(): Gateway.PolicyConfig {
        return Gateway.PolicyConfig.newBuilder()
            .setId(id)
            .setEnvironment(environment)
            .setMaxPartitions(maxPartitions)
            .setMinPartitions(minPartitions)
            .setMaxRetentionMs(maxRetentionMs)
            .setMinReplicationFactor(minReplicationFactor)
            .addAllAllowedCleanupPolicies(allowedCleanupPolicies)
            .setNamingPattern(namingPattern)
            .setMaxNameLength(maxNameLength)
            .build()
    }

    // ========================================================================
    // Topic ACL Management
    // ========================================================================

    override suspend fun upsertTopicACL(
        request: Gateway.UpsertTopicACLRequest
    ): Gateway.UpsertTopicACLResponse {
        logger.info { "UpsertTopicACL: ${request.entry.id}" }

        val entry = request.entry.toKotlin()
        aclStore.upsert(entry)

        return Gateway.UpsertTopicACLResponse.newBuilder()
            .setSuccess(true)
            .build()
    }

    override suspend fun revokeTopicACL(
        request: Gateway.RevokeTopicACLRequest
    ): Gateway.RevokeTopicACLResponse {
        logger.info { "RevokeTopicACL: ${request.aclId}" }
        val success = aclStore.revoke(request.aclId)
        return Gateway.RevokeTopicACLResponse.newBuilder()
            .setSuccess(success)
            .build()
    }

    override suspend fun listTopicACLs(
        request: Gateway.ListTopicACLsRequest
    ): Gateway.ListTopicACLsResponse {
        val entries = if (request.credentialId.isNotEmpty()) {
            aclStore.getByCredential(request.credentialId)
        } else {
            aclStore.getAll()
        }

        return Gateway.ListTopicACLsResponse.newBuilder()
            .addAllEntries(entries.map { it.toProto() })
            .build()
    }

    // ========================================================================
    // ACLEntry conversion functions
    // ========================================================================

    private fun Gateway.TopicACLEntry.toKotlin(): ACLEntry {
        val expiresAtInstant = if (hasExpiresAt() && expiresAt.seconds > 0) {
            Instant.ofEpochSecond(expiresAt.seconds, expiresAt.nanos.toLong())
        } else {
            null
        }

        return ACLEntry(
            id = id,
            credentialId = credentialId,
            topicPhysicalName = topicPhysicalName,
            permissions = permissionsList.toSet(),
            expiresAt = expiresAtInstant
        )
    }

    private fun ACLEntry.toProto(): Gateway.TopicACLEntry {
        val builder = Gateway.TopicACLEntry.newBuilder()
            .setId(id)
            .setCredentialId(credentialId)
            .setTopicPhysicalName(topicPhysicalName)
            .addAllPermissions(permissions)

        expiresAt?.let {
            builder.setExpiresAt(
                Timestamp.newBuilder()
                    .setSeconds(it.epochSecond)
                    .setNanos(it.nano)
                    .build()
            )
        }

        return builder.build()
    }
}
