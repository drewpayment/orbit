// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/FilterChain.kt
package io.orbit.bifrost.filter

import mu.KotlinLogging
import org.apache.kafka.common.requests.AbstractRequest
import org.apache.kafka.common.requests.AbstractResponse

private val logger = KotlinLogging.logger {}

/**
 * Manages the ordered chain of filters applied to Kafka protocol messages.
 */
class FilterChain(
    private val filters: List<BifrostFilter>
) {
    private val sortedFilters = filters.sortedBy { it.order }

    suspend fun processRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        var currentRequest = request

        for (filter in sortedFilters) {
            when (val result = filter.onRequest(context, apiKey, currentRequest)) {
                is FilterResult.Pass -> continue
                is FilterResult.Modify -> currentRequest = result.value
                is FilterResult.Reject -> {
                    logger.warn { "Request rejected by ${filter.name}: ${result.message}" }
                    return result
                }
            }
        }

        return FilterResult.Pass(currentRequest)
    }

    suspend fun processResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        var currentResponse = response

        // Process in reverse order for responses
        for (filter in sortedFilters.reversed()) {
            when (val result = filter.onResponse(context, apiKey, currentResponse)) {
                is FilterResult.Pass -> continue
                is FilterResult.Modify -> currentResponse = result.value
                is FilterResult.Reject -> {
                    logger.warn { "Response rejected by ${filter.name}: ${result.message}" }
                    return result
                }
            }
        }

        return FilterResult.Pass(currentResponse)
    }

    companion object {
        fun builder() = FilterChainBuilder()
    }
}

class FilterChainBuilder {
    private val filters = mutableListOf<BifrostFilter>()

    fun addFilter(filter: BifrostFilter): FilterChainBuilder {
        filters.add(filter)
        return this
    }

    fun build(): FilterChain = FilterChain(filters)
}
