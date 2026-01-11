/**
 * Notification Service Types
 *
 * Defines the interface for the notification service that supports
 * email notifications with graceful degradation to logging when
 * email is not configured.
 */

export type NotificationTemplate =
  | 'approval-submitted'
  | 'approval-needed'
  | 'request-approved'
  | 'request-rejected'

export interface NotificationRecipient {
  email: string
  name: string
}

export interface NotificationPayload {
  to: NotificationRecipient
  subject: string
  template: NotificationTemplate
  data: Record<string, unknown>
}

export interface NotificationResult {
  success: boolean
  channel: 'email' | 'log-only'
  error?: string
}

/**
 * Template-specific data types for type safety
 */
export interface ApprovalSubmittedData {
  applicationName: string
  workspaceName: string
  requesterName: string
  requestId: string
}

export interface ApprovalNeededData {
  applicationName: string
  workspaceName: string
  requesterName: string
  requestId: string
  tier: 'workspace' | 'platform'
  approvalUrl: string
}

export interface RequestApprovedData {
  applicationName: string
  workspaceName: string
  approverName: string
  platformAction?: 'approved_single' | 'increased_quota'
}

export interface RequestRejectedData {
  applicationName: string
  workspaceName: string
  rejectedByName: string
  rejectionReason?: string
  tier: 'workspace' | 'platform'
}
