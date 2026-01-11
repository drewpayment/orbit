package io.orbit.bifrost.callback

import mu.KotlinLogging
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private val logger = KotlinLogging.logger {}

/**
 * ActivityEmitter periodically flushes accumulated client activity to Orbit
 * via the BifrostCallbackService gRPC client.
 *
 * Configuration:
 * - flushIntervalSeconds: How often to flush activity (default: 30 seconds)
 * - enabled: Whether activity emission is enabled (can be disabled for testing)
 *
 * The emitter runs on a dedicated scheduled executor thread to avoid blocking
 * the main Kafka protocol processing threads.
 */
class ActivityEmitter(
    private val accumulator: ActivityAccumulator,
    private val callbackClient: BifrostCallbackClient,
    private val flushIntervalSeconds: Long = 30,
    private val enabled: Boolean = true
) {
    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "bifrost-activity-emitter").apply {
            isDaemon = true
        }
    }

    private val running = AtomicBoolean(false)

    /**
     * Starts the periodic activity emission.
     */
    fun start() {
        if (!enabled) {
            logger.info { "Activity emitter is disabled, not starting" }
            return
        }

        if (running.compareAndSet(false, true)) {
            logger.info { "Starting activity emitter with ${flushIntervalSeconds}s flush interval" }
            scheduler.scheduleAtFixedRate(
                { flushSafely() },
                flushIntervalSeconds,
                flushIntervalSeconds,
                TimeUnit.SECONDS
            )
        }
    }

    /**
     * Stops the periodic activity emission and performs a final flush.
     */
    fun stop() {
        if (running.compareAndSet(true, false)) {
            logger.info { "Stopping activity emitter" }
            scheduler.shutdown()
            try {
                // Perform a final flush before shutdown
                flushSafely()
                if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow()
                }
            } catch (e: InterruptedException) {
                scheduler.shutdownNow()
                Thread.currentThread().interrupt()
            }
        }
    }

    /**
     * Manually triggers a flush (useful for testing or shutdown).
     */
    fun flushNow() {
        flushSafely()
    }

    /**
     * Wraps flush in exception handling to prevent scheduler termination on error.
     */
    private fun flushSafely() {
        try {
            val records = accumulator.flush()
            if (records.isNotEmpty()) {
                logger.debug { "Emitting ${records.size} activity records to Orbit" }
                callbackClient.emitClientActivity(records)
                logger.info { "Successfully emitted ${records.size} activity records" }
            }
        } catch (e: Exception) {
            logger.error(e) { "Failed to emit activity records to Orbit" }
            // Don't rethrow - we don't want to terminate the scheduler
        }
    }
}
