import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendNotification, sendNotifications, createNotification } from './service'
import type { NotificationPayload } from './types'

// Mock Payload instance
const createMockPayload = (emailConfigured: boolean, shouldFail = false) => ({
  email: emailConfigured
    ? {
        sendEmail: vi.fn().mockImplementation(() => {
          if (shouldFail) {
            throw new Error('SMTP connection failed')
          }
          return Promise.resolve()
        }),
      }
    : undefined,
})

// Mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
})

describe('Notification Service', () => {
  describe('sendNotification', () => {
    const baseNotification: NotificationPayload = {
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Test Subject',
      template: 'request-approved',
      data: {
        applicationName: 'test-app',
        workspaceName: 'test-workspace',
        approverName: 'Admin User',
      },
    }

    it('should send email when email is configured', async () => {
      const mockPayload = createMockPayload(true)
      const mockLogger = createMockLogger()

      const result = await sendNotification(
        mockPayload as never,
        baseNotification,
        mockLogger
      )

      expect(result.success).toBe(true)
      expect(result.channel).toBe('email')
      expect(mockPayload.email?.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Approved'),
        })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Notification triggered',
        expect.any(Object)
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email sent successfully',
        expect.any(Object)
      )
    })

    it('should fall back to log-only when email is not configured', async () => {
      const mockPayload = createMockPayload(false)
      const mockLogger = createMockLogger()

      const result = await sendNotification(
        mockPayload as never,
        baseNotification,
        mockLogger
      )

      expect(result.success).toBe(true)
      expect(result.channel).toBe('log-only')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Notification triggered',
        expect.any(Object)
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email not configured, using log-only mode',
        expect.any(Object)
      )
    })

    it('should fall back to log-only when email fails', async () => {
      const mockPayload = createMockPayload(true, true) // configured but fails
      const mockLogger = createMockLogger()

      const result = await sendNotification(
        mockPayload as never,
        baseNotification,
        mockLogger
      )

      expect(result.success).toBe(true)
      expect(result.channel).toBe('log-only')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Email failed, falling back to log-only',
        expect.objectContaining({
          error: 'SMTP connection failed',
        })
      )
    })

    it('should always log notification for audit trail', async () => {
      const mockPayload = createMockPayload(false)
      const mockLogger = createMockLogger()

      await sendNotification(mockPayload as never, baseNotification, mockLogger)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Notification triggered',
        expect.objectContaining({
          template: 'request-approved',
          to: 'user@example.com',
          toName: 'Test User',
          data: baseNotification.data,
        })
      )
    })
  })

  describe('sendNotifications', () => {
    it('should send multiple notifications in parallel', async () => {
      const mockPayload = createMockPayload(true)
      const mockLogger = createMockLogger()

      const notifications: NotificationPayload[] = [
        {
          to: { email: 'user1@example.com', name: 'User 1' },
          subject: 'Test 1',
          template: 'request-approved',
          data: { applicationName: 'app1', workspaceName: 'ws1', approverName: 'Admin' },
        },
        {
          to: { email: 'user2@example.com', name: 'User 2' },
          subject: 'Test 2',
          template: 'request-rejected',
          data: {
            applicationName: 'app2',
            workspaceName: 'ws2',
            rejectedByName: 'Admin',
            tier: 'workspace',
          },
        },
      ]

      const results = await sendNotifications(
        mockPayload as never,
        notifications,
        mockLogger
      )

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.success)).toBe(true)
      expect(mockPayload.email?.sendEmail).toHaveBeenCalledTimes(2)
    })
  })

  describe('createNotification', () => {
    it('should create a notification payload with correct subject', () => {
      const notification = createNotification(
        { email: 'user@example.com', name: 'Test User' },
        'approval-needed',
        {
          applicationName: 'my-app',
          workspaceName: 'my-workspace',
          requesterName: 'Requester',
          requestId: '123',
          tier: 'workspace',
          approvalUrl: 'https://example.com/approve',
        }
      )

      expect(notification.to.email).toBe('user@example.com')
      expect(notification.template).toBe('approval-needed')
      expect(notification.subject).toContain('Action Required')
      expect(notification.subject).toContain('my-app')
    })
  })
})

describe('Email Templates', () => {
  const mockPayload = createMockPayload(true)
  const mockLogger = createMockLogger()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate approval-submitted template', async () => {
    const notification: NotificationPayload = {
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Test',
      template: 'approval-submitted',
      data: {
        applicationName: 'payments-service',
        workspaceName: 'acme-corp',
        requesterName: 'John Doe',
        requestId: '123',
      },
    }

    await sendNotification(mockPayload as never, notification, mockLogger)

    expect(mockPayload.email?.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('payments-service'),
        html: expect.stringContaining('Pending Workspace Approval'),
      })
    )
  })

  it('should generate approval-needed template for workspace tier', async () => {
    const notification: NotificationPayload = {
      to: { email: 'admin@example.com', name: 'Admin' },
      subject: 'Test',
      template: 'approval-needed',
      data: {
        applicationName: 'payments-service',
        workspaceName: 'acme-corp',
        requesterName: 'John Doe',
        requestId: '123',
        tier: 'workspace',
        approvalUrl: 'https://orbit.io/approve/123',
      },
    }

    await sendNotification(mockPayload as never, notification, mockLogger)

    expect(mockPayload.email?.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Action Required'),
        html: expect.stringContaining('Workspace Approval Required'),
      })
    )
    // Also verify the button is present
    expect(mockPayload.email?.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Review Request'),
      })
    )
  })

  it('should generate request-approved template', async () => {
    const notification: NotificationPayload = {
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Test',
      template: 'request-approved',
      data: {
        applicationName: 'payments-service',
        workspaceName: 'acme-corp',
        approverName: 'Platform Admin',
        platformAction: 'increased_quota',
      },
    }

    await sendNotification(mockPayload as never, notification, mockLogger)

    expect(mockPayload.email?.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Approved'),
        html: expect.stringContaining('quota has also been increased'),
      })
    )
  })

  it('should generate request-rejected template with reason', async () => {
    const notification: NotificationPayload = {
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Test',
      template: 'request-rejected',
      data: {
        applicationName: 'payments-service',
        workspaceName: 'acme-corp',
        rejectedByName: 'Workspace Admin',
        rejectionReason: 'Duplicate application already exists',
        tier: 'workspace',
      },
    }

    await sendNotification(mockPayload as never, notification, mockLogger)

    expect(mockPayload.email?.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Rejected'),
        html: expect.stringContaining('Duplicate application already exists'),
      })
    )
  })
})
