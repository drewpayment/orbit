// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/BifrostFilter.kt
package io.orbit.bifrost.filter

import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse

/**
 * Base interface for Bifrost filters.
 * Filters can intercept and modify Kafka protocol requests/responses.
 */
interface BifrostFilter {
    val name: String
    val order: Int get() = 100

    /**
     * Process an inbound request before forwarding to broker.
     * Return null to pass through unchanged, or a modified request.
     */
    suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest>

    /**
     * Process an outbound response before returning to client.
     * Return null to pass through unchanged, or a modified response.
     */
    suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse>
}

sealed class FilterResult<T> {
    data class Pass<T>(val value: T) : FilterResult<T>()
    data class Modify<T>(val value: T) : FilterResult<T>()
    data class Reject<T>(val errorCode: Short, val message: String) : FilterResult<T>()
}
