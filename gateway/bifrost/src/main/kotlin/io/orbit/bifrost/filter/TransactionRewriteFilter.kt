// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/TransactionRewriteFilter.kt
package io.orbit.bifrost.filter

import mu.KotlinLogging
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.*

private val logger = KotlinLogging.logger {}

/**
 * Rewrites transactional.id by adding tenant prefix.
 * Enables idempotent producers with same IDs in different tenants.
 */
class TransactionRewriteFilter : BifrostFilter {
    override val name = "TransactionRewriteFilter"
    override val order = 30  // After group rewriting

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        if (context.transactionIdPrefix.isEmpty()) {
            return FilterResult.Pass(request)
        }

        val key = apiKey.toInt()
        return when {
            key == ApiKeys.INIT_PRODUCER_ID.id.toInt() -> rewriteInitProducerIdRequest(context, request as InitProducerIdRequest)
            key == ApiKeys.ADD_PARTITIONS_TO_TXN.id.toInt() -> rewriteAddPartitionsToTxnRequest(context, request as AddPartitionsToTxnRequest)
            key == ApiKeys.ADD_OFFSETS_TO_TXN.id.toInt() -> rewriteAddOffsetsToTxnRequest(context, request as AddOffsetsToTxnRequest)
            key == ApiKeys.END_TXN.id.toInt() -> rewriteEndTxnRequest(context, request as EndTxnRequest)
            key == ApiKeys.TXN_OFFSET_COMMIT.id.toInt() -> rewriteTxnOffsetCommitRequest(context, request as TxnOffsetCommitRequest)
            else -> FilterResult.Pass(request)
        }
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        // Transaction responses don't expose transactional.id, so no rewriting needed
        return FilterResult.Pass(response)
    }

    private fun rewriteInitProducerIdRequest(
        context: FilterContext,
        request: InitProducerIdRequest
    ): FilterResult<AbstractRequest> {
        val txnId = request.data().transactionalId()
        if (txnId != null && txnId.isNotEmpty()) {
            val prefixedTxnId = context.transactionIdPrefix + txnId
            logger.debug { "Rewriting InitProducerId transactionalId: $txnId -> $prefixedTxnId" }
        }
        return FilterResult.Pass(request)
    }

    private fun rewriteAddPartitionsToTxnRequest(
        context: FilterContext,
        request: AddPartitionsToTxnRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot perform transactions: virtual cluster is in read-only mode"
            )
        }
        logger.debug { "Rewriting AddPartitionsToTxn with prefix: ${context.transactionIdPrefix}" }
        return FilterResult.Pass(request)
    }

    private fun rewriteAddOffsetsToTxnRequest(
        context: FilterContext,
        request: AddOffsetsToTxnRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot perform transactions: virtual cluster is in read-only mode"
            )
        }
        return FilterResult.Pass(request)
    }

    private fun rewriteEndTxnRequest(
        context: FilterContext,
        request: EndTxnRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot perform transactions: virtual cluster is in read-only mode"
            )
        }
        return FilterResult.Pass(request)
    }

    private fun rewriteTxnOffsetCommitRequest(
        context: FilterContext,
        request: TxnOffsetCommitRequest
    ): FilterResult<AbstractRequest> {
        if (context.isReadOnly) {
            return FilterResult.Reject(
                errorCode = 29,
                message = "Cannot perform transactions: virtual cluster is in read-only mode"
            )
        }
        return FilterResult.Pass(request)
    }
}
