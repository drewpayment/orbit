import type { CollectionAfterChangeHook } from 'payload'
import { getMongoClient } from '@/lib/mongodb'

/**
 * Syncs user approval status changes from Payload admin to Better Auth.
 *
 * When an admin changes a user's status in Payload:
 * - approved: Updates Better Auth user status, optionally sets emailVerified
 *   and triggers verification email via Resend
 * - rejected: Updates Better Auth user status
 */
export const userApprovalAfterChangeHook: CollectionAfterChangeHook = async ({
  operation,
  doc,
  previousDoc,
  req: { payload, user: adminUser },
}) => {
  // Only run on update (not create — create is handled by signup flow)
  if (operation !== 'update') return doc

  const previousStatus = previousDoc?.status
  const newStatus = doc.status

  // Only act when status actually changed
  if (previousStatus === newStatus) return doc

  const mongoClient = await getMongoClient()
  const db = mongoClient.db()
  const baUserCollection = db.collection('user')

  // Find the Better Auth user by email
  const baUser = await baUserCollection.findOne({ email: doc.email })
  if (!baUser) {
    console.warn(`[userApprovalHook] No Better Auth user found for email: ${doc.email}`)
    return doc
  }

  if (newStatus === 'approved') {
    const skipVerification = doc.skipEmailVerification === true

    // Update Better Auth user
    const updateData: Record<string, unknown> = {
      status: 'approved',
    }
    if (skipVerification) {
      updateData.emailVerified = true
    }
    await baUserCollection.updateOne(
      { _id: baUser._id },
      { $set: updateData },
    )

    // Update Payload doc with approval metadata
    // Type assertion needed because generated types don't include new fields until next build
    await payload.update({
      collection: 'users',
      id: doc.id,
      data: {
        registrationApprovedAt: new Date().toISOString(),
        registrationApprovedBy: adminUser?.id,
      } as any,
      context: { skipApprovalHook: true },
    })

    if (!skipVerification) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@hoytlabs.app'
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        // Create a verification token in Better Auth's verification collection
        const crypto = await import('crypto')
        const token = crypto.randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

        await db.collection('verification').insertOne({
          identifier: doc.email,
          value: token,
          expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        const verificationUrl = `${appUrl}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(appUrl + '/login')}`

        await resend.emails.send({
          from: fromEmail,
          to: doc.email,
          subject: 'Verify your Orbit account',
          html: `
            <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Verify your email address</h2>
              <p>Your Orbit account has been approved! Click the link below to verify your email and start using Orbit.</p>
              <p style="margin: 24px 0;">
                <a href="${verificationUrl}" style="display: inline-block; background: #FF5C00; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                  Verify Email
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">This link expires in 24 hours. If you didn't create an Orbit account, you can ignore this email.</p>
            </div>
          `,
        })

        console.log(`[userApprovalHook] Verification email sent to ${doc.email}`)
      } catch (error) {
        console.error(`[userApprovalHook] Failed to send verification email to ${doc.email}:`, error)
      }
    } else {
      console.log(`[userApprovalHook] User ${doc.email} approved with email verification bypassed`)
    }
  } else if (newStatus === 'rejected') {
    await baUserCollection.updateOne(
      { _id: baUser._id },
      { $set: { status: 'rejected' } },
    )
    console.log(`[userApprovalHook] User ${doc.email} registration rejected`)
  }

  return doc
}
