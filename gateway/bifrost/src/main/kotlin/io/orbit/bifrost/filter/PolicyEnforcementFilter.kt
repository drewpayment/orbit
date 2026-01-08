// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/PolicyEnforcementFilter.kt
package io.orbit.bifrost.filter

import io.orbit.bifrost.policy.PolicyConfig
import io.orbit.bifrost.policy.PolicyStore
import io.orbit.bifrost.policy.PolicyViolation
import mu.KotlinLogging
import org.apache.kafka.common.message.CreateTopicsRequestData.CreatableTopicConfig
import org.apache.kafka.common.message.CreateTopicsRequestData.CreatableTopicConfigCollection
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.protocol.Errors
import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse
import org.apache.kafka.common.requests.CreateTopicsRequest

private val logger = KotlinLogging.logger {}

/**
 * Enforces topic creation policies by validating CreateTopics requests
 * against environment-specific policies stored in PolicyStore.
 *
 * This filter runs BEFORE TopicRewriteFilter (order 5 vs order 10) to
 * validate topic configurations before any name rewriting occurs.
 */
class PolicyEnforcementFilter(private val policyStore: PolicyStore) : BifrostFilter {
    override val name = "PolicyEnforcementFilter"
    override val order = 5  // Run BEFORE TopicRewriteFilter (order 10)

    /**
     * Default lenient policy used when no environment-specific policy is configured.
     * This allows most reasonable configurations to pass through.
     */
    private val defaultPolicy = PolicyConfig(
        id = "default",
        environment = "default",
        maxPartitions = 100,
        minPartitions = 1,
        maxRetentionMs = Long.MAX_VALUE,
        minReplicationFactor = 1,
        allowedCleanupPolicies = listOf("delete", "compact", "compact,delete"),
        namingPattern = ".*",
        maxNameLength = 255
    )

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        // Only process CREATE_TOPICS requests
        if (apiKey.toInt() != ApiKeys.CREATE_TOPICS.id.toInt()) {
            return FilterResult.Pass(request)
        }

        // Safe type check before casting
        if (request !is CreateTopicsRequest) {
            logger.warn { "Expected CreateTopicsRequest but got ${request.javaClass.simpleName}" }
            return FilterResult.Pass(request)
        }

        return validateCreateTopics(context, request)
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        // Always pass through responses unchanged
        return FilterResult.Pass(response)
    }

    /**
     * Validates a CreateTopics request against the applicable policy.
     * Collects all violations across all topics in the request.
     */
    private fun validateCreateTopics(
        context: FilterContext,
        request: CreateTopicsRequest
    ): FilterResult<AbstractRequest> {
        val environment = context.virtualCluster?.environment ?: "default"
        val policies = policyStore.getByEnvironment(environment)
        val policy = policies.firstOrNull() ?: defaultPolicy

        logger.debug { "Validating CreateTopics request for environment: $environment using policy: ${policy.id}" }

        val allViolations = mutableListOf<PolicyViolation>()

        for (topic in request.data().topics()) {
            val topicName = topic.name()
            val partitions = topic.numPartitions()
            val replicationFactor = topic.replicationFactor().toInt()
            val retentionMs = extractRetentionMs(topic.configs())
            val cleanupPolicy = extractCleanupPolicy(topic.configs())

            val violations = policy.validate(
                topicName = topicName,
                partitions = partitions,
                replicationFactor = replicationFactor,
                retentionMs = retentionMs,
                cleanupPolicy = cleanupPolicy
            )

            if (violations.isNotEmpty()) {
                logger.info { "Policy violations for topic '$topicName': ${violations.map { it.message }}" }
                allViolations.addAll(violations)
            }
        }

        return if (allViolations.isNotEmpty()) {
            val message = buildViolationMessage(allViolations)
            logger.warn { "Rejecting CreateTopics request: $message" }
            FilterResult.Reject(
                errorCode = Errors.POLICY_VIOLATION.code(),
                message = message
            )
        } else {
            FilterResult.Pass(request)
        }
    }

    /**
     * Extracts retention.ms config value from topic configs.
     */
    private fun extractRetentionMs(configs: CreatableTopicConfigCollection): Long? {
        return configs
            .find { it.name() == "retention.ms" }
            ?.value()
            ?.toLongOrNull()
    }

    /**
     * Extracts cleanup.policy config value from topic configs.
     */
    private fun extractCleanupPolicy(configs: CreatableTopicConfigCollection): String? {
        return configs
            .find { it.name() == "cleanup.policy" }
            ?.value()
    }

    /**
     * Builds a human-readable message from policy violations.
     */
    private fun buildViolationMessage(violations: List<PolicyViolation>): String {
        return violations.joinToString("; ") { it.message }
    }
}
