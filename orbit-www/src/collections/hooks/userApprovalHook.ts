import type { CollectionAfterChangeHook } from 'payload'
import { getMongoClient } from '@/lib/mongodb'

/**
 * Syncs user approval status changes from Payload admin to Better Auth.
 *
 * When an admin changes a user's status in Payload:
 * - approved (skip unchecked): marks the Better Auth user approved and asks
 *   Better Auth's server API to mint + send a valid verification email
 * - approved (skip checked): marks the Better Auth user approved and verified,
 *   no email
 * - skip checked on an already-approved user (status unchanged): retroactively
 *   marks the Better Auth user verified, no email
 * - rejected: marks the Better Auth user rejected
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
  const statusChanged = previousStatus !== newStatus

  // Retroactive skip: the checkbox flipped true on an already-approved user
  // whose status did not otherwise change. The hook normally only fires on a
  // status change, so this branch handles "approve now, skip verification
  // later" as a separate save.
  const retroactiveSkip =
    !statusChanged &&
    newStatus === 'approved' &&
    previousDoc?.skipEmailVerification !== true &&
    doc.skipEmailVerification === true

  if (!statusChanged && !retroactiveSkip) return doc

  const mongoClient = await getMongoClient()
  const db = mongoClient.db()
  const baUserCollection = db.collection('user')

  // Find the Better Auth user by email
  const baUser = await baUserCollection.findOne({ email: doc.email })
  if (!baUser) {
    console.warn(`[userApprovalHook] No Better Auth user found for email: ${doc.email}`)
    return doc
  }

  if (retroactiveSkip) {
    await baUserCollection.updateOne(
      { _id: baUser._id },
      { $set: { emailVerified: true } },
    )
    console.log(`[userApprovalHook] Email verification retroactively skipped for ${doc.email}`)
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
    await payload.update({
      collection: 'users',
      id: doc.id,
      data: {
        registrationApprovedAt: new Date().toISOString(),
        registrationApprovedBy: adminUser?.id,
      },
      context: { skipApprovalHook: true },
    })

    if (!skipVerification) {
      // Ask Better Auth to mint its OWN signed token and route it through the
      // single sender in lib/auth.ts. Dynamic import avoids any config-load
      // cycle (Users -> hook -> auth) and keeps this the sole email path.
      try {
        const { auth } = await import('@/lib/auth')
        await auth.api.sendVerificationEmail({
          body: { email: doc.email, callbackURL: '/login' },
        })
        console.log(`[userApprovalHook] Verification email requested for ${doc.email}`)
      } catch (error) {
        // Approval itself must not roll back if delivery fails.
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
