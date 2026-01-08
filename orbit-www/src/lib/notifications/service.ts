/**
 * Notification Service
 *
 * Handles sending notifications with graceful degradation:
 * 1. Always logs the notification for audit trail
 * 2. Attempts to send email if Payload email adapter is configured
 * 3. Falls back to log-only if email is not available
 */

import type { Payload } from 'payload'
import type { NotificationPayload, NotificationResult } from './types'
import { getEmailContent } from './templates'

/**
 * Logger interface for notification audit trail
 */
interface NotificationLogger {
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
}

/**
 * Default console-based logger
 */
const defaultLogger: NotificationLogger = {
  info: (message, meta) => console.log(`[NOTIFICATION] ${message}`, meta),
  warn: (message, meta) => console.warn(`[NOTIFICATION] ${message}`, meta),
  error: (message, meta) => console.error(`[NOTIFICATION] ${message}`, meta),
}

/**
 * Check if Payload email is configured and available
 */
function isEmailConfigured(payload: Payload): boolean {
  try {
    // Payload 3.x uses payload.email to send emails
    // If email adapter is not configured, this will be undefined or throw
    return typeof payload.email?.sendEmail === 'function'
  } catch {
    return false
  }
}

/**
 * Send notification with graceful degradation
 *
 * @param payload - Payload CMS instance
 * @param notification - Notification payload
 * @param logger - Optional logger (defaults to console)
 * @returns NotificationResult indicating success and channel used
 */
export async function sendNotification(
  payload: Payload,
  notification: NotificationPayload,
  logger: NotificationLogger = defaultLogger
): Promise<NotificationResult> {
  const { to, template, data } = notification

  // 1. Always log the notification for audit trail
  logger.info('Notification triggered', {
    template,
    to: to.email,
    toName: to.name,
    data,
  })

  // 2. Try email if configured
  if (isEmailConfigured(payload)) {
    try {
      const emailContent = getEmailContent(template, data)

      await payload.email?.sendEmail({
        to: to.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      })

      logger.info('Email sent successfully', {
        template,
        to: to.email,
      })

      return { success: true, channel: 'email' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.warn('Email failed, falling back to log-only', {
        template,
        to: to.email,
        error: errorMessage,
      })
      // Fall through to log-only result
    }
  } else {
    logger.info('Email not configured, using log-only mode', {
      template,
      to: to.email,
    })
  }

  // 3. Graceful degradation - notification was logged
  return { success: true, channel: 'log-only' }
}

/**
 * Send notification to multiple recipients
 *
 * @param payload - Payload CMS instance
 * @param notifications - Array of notification payloads
 * @param logger - Optional logger
 * @returns Array of results for each notification
 */
export async function sendNotifications(
  payload: Payload,
  notifications: NotificationPayload[],
  logger: NotificationLogger = defaultLogger
): Promise<NotificationResult[]> {
  const results = await Promise.all(
    notifications.map((notification) => sendNotification(payload, notification, logger))
  )
  return results
}

/**
 * Create a notification payload helper
 */
export function createNotification(
  to: { email: string; name: string },
  template: NotificationPayload['template'],
  data: Record<string, unknown>
): NotificationPayload {
  const emailContent = getEmailContent(template, data)
  return {
    to,
    subject: emailContent.subject,
    template,
    data,
  }
}
