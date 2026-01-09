package io.orbit.bifrost.metrics

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry

/**
 * Configures the metrics admin endpoint for the Bifrost Kafka Gateway.
 *
 * This endpoint exposes Prometheus-compatible metrics at /metrics,
 * a health check endpoint at /health, and a readiness endpoint at /ready.
 *
 * @param registry The Prometheus meter registry to scrape metrics from
 */
fun Application.configureMetricsEndpoint(registry: PrometheusMeterRegistry) {
    routing {
        get("/metrics") {
            call.respondText(registry.scrape(), ContentType.Text.Plain)
        }

        get("/health") {
            call.respondText("OK", ContentType.Text.Plain)
        }

        get("/ready") {
            call.respondText("READY", ContentType.Text.Plain)
        }
    }
}
