/**
 * Email Templates for Notification Service
 *
 * Simple HTML email templates for approval workflow notifications.
 */

import type {
  NotificationTemplate,
  ApprovalSubmittedData,
  ApprovalNeededData,
  RequestApprovedData,
  RequestRejectedData,
} from './types'

interface EmailContent {
  subject: string
  html: string
  text: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getApprovalSubmittedContent(data: ApprovalSubmittedData): EmailContent {
  const subject = `Kafka Application Request Submitted: ${data.applicationName}`
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Application Request Submitted</h2>
      <p>Your request for a new Kafka application has been submitted and is pending approval.</p>
      <table style="margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Application:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.applicationName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Workspace:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.workspaceName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Status:</td>
          <td style="padding: 8px 0;"><span style="background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 4px; font-size: 14px;">Pending Workspace Approval</span></td>
        </tr>
      </table>
      <p style="color: #666; font-size: 14px;">You will be notified when your request is approved or rejected.</p>
    </div>
  `
  const text = `Application Request Submitted

Your request for a new Kafka application has been submitted and is pending approval.

Application: ${data.applicationName}
Workspace: ${data.workspaceName}
Status: Pending Workspace Approval

You will be notified when your request is approved or rejected.`

  return { subject, html, text }
}

function getApprovalNeededContent(data: ApprovalNeededData): EmailContent {
  const tierLabel = data.tier === 'workspace' ? 'Workspace' : 'Platform'
  const subject = `[Action Required] Kafka Application Approval Needed: ${data.applicationName}`
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">${tierLabel} Approval Required</h2>
      <p>A new Kafka application request requires your approval.</p>
      <table style="margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Application:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.applicationName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Workspace:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.workspaceName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Requested by:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.requesterName)}</td>
        </tr>
      </table>
      <p>
        <a href="${escapeHtml(data.approvalUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
          Review Request
        </a>
      </p>
    </div>
  `
  const text = `${tierLabel} Approval Required

A new Kafka application request requires your approval.

Application: ${data.applicationName}
Workspace: ${data.workspaceName}
Requested by: ${data.requesterName}

Review the request at: ${data.approvalUrl}`

  return { subject, html, text }
}

function getRequestApprovedContent(data: RequestApprovedData): EmailContent {
  const quotaNote =
    data.platformAction === 'increased_quota'
      ? " Your workspace's application quota has also been increased."
      : ''

  const subject = `Kafka Application Approved: ${data.applicationName}`
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Application Request Approved</h2>
      <p>Great news! Your Kafka application request has been approved.${quotaNote}</p>
      <table style="margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Application:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.applicationName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Workspace:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.workspaceName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Approved by:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.approverName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Status:</td>
          <td style="padding: 8px 0;"><span style="background: #d1fae5; color: #065f46; padding: 4px 8px; border-radius: 4px; font-size: 14px;">Approved</span></td>
        </tr>
      </table>
      <p>Your application and virtual clusters are being provisioned now. You can access your application from the Kafka Applications page.</p>
    </div>
  `
  const text = `Application Request Approved

Great news! Your Kafka application request has been approved.${quotaNote}

Application: ${data.applicationName}
Workspace: ${data.workspaceName}
Approved by: ${data.approverName}
Status: Approved

Your application and virtual clusters are being provisioned now. You can access your application from the Kafka Applications page.`

  return { subject, html, text }
}

function getRequestRejectedContent(data: RequestRejectedData): EmailContent {
  const tierLabel = data.tier === 'workspace' ? 'workspace admin' : 'platform admin'
  const reasonText = data.rejectionReason
    ? `Reason: ${data.rejectionReason}`
    : 'No reason was provided.'

  const subject = `Kafka Application Request Rejected: ${data.applicationName}`
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Application Request Rejected</h2>
      <p>Unfortunately, your Kafka application request has been rejected by a ${tierLabel}.</p>
      <table style="margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Application:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.applicationName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Workspace:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.workspaceName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Rejected by:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(data.rejectedByName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px 8px 0; color: #666;">Status:</td>
          <td style="padding: 8px 0;"><span style="background: #fee2e2; color: #991b1b; padding: 4px 8px; border-radius: 4px; font-size: 14px;">Rejected</span></td>
        </tr>
      </table>
      ${data.rejectionReason ? `<p><strong>Reason:</strong> ${escapeHtml(data.rejectionReason)}</p>` : '<p style="color: #666;">No reason was provided.</p>'}
      <p style="color: #666; font-size: 14px;">If you believe this was in error, please contact the administrator.</p>
    </div>
  `
  const text = `Application Request Rejected

Unfortunately, your Kafka application request has been rejected by a ${tierLabel}.

Application: ${data.applicationName}
Workspace: ${data.workspaceName}
Rejected by: ${data.rejectedByName}
Status: Rejected

${reasonText}

If you believe this was in error, please contact the administrator.`

  return { subject, html, text }
}

export function getEmailContent(
  template: NotificationTemplate,
  data: Record<string, unknown>
): EmailContent {
  switch (template) {
    case 'approval-submitted':
      return getApprovalSubmittedContent(data as ApprovalSubmittedData)
    case 'approval-needed':
      return getApprovalNeededContent(data as ApprovalNeededData)
    case 'request-approved':
      return getRequestApprovedContent(data as RequestApprovedData)
    case 'request-rejected':
      return getRequestRejectedContent(data as RequestRejectedData)
    default:
      throw new Error(`Unknown template: ${template}`)
  }
}
