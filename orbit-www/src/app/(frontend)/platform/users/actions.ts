'use server'

import crypto from 'node:crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { ObjectId } from 'mongodb'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { getMongoClient } from '@/lib/mongodb'
import { auth } from '@/lib/auth'
import { canManageTarget, canAssignRole, type UserRole, type ActionResult } from './policy'

// Server actions for the platform-admin Users page. Every mutation re-checks the
// session server-side (isPlatformAdmin) plus the policy matrix, then acts across
// both stores: Payload `users` (source of truth for name/role/status) and the
// Better-Auth `user` doc (auth-facing mirror of role/status/emailVerified). See
// docs/plans/2026-07-11-platform-user-management.md.

const USERS_PATH = '/platform/users'
const INVITE_REDIRECT = '/reset-password?invite=1'
const RESET_REDIRECT = '/reset-password'

interface ActorUser {
  id: string
  email: string
  role: UserRole
  betterAuthId?: string | null
  status?: string | null
}

interface TargetUser {
  id: string
  email: string
  name?: string | null
  role: UserRole
  status?: string | null
  betterAuthId?: string | null
}

const forbidden: ActionResult<never> = { ok: false, error: 'Forbidden' }

/** Session-gate + platform-admin check shared by every action. */
async function requirePlatformAdmin(): Promise<ActorUser | null> {
  const user = await getPayloadUserFromSession()
  if (!user || !isPlatformAdmin(user)) return null
  return {
    id: String(user.id),
    email: user.email,
    role: (user.role ?? 'user') as UserRole,
    betterAuthId: user.betterAuthId,
    status: user.status,
  }
}

async function loadTarget(userId: string): Promise<TargetUser | null> {
  const payload = await getPayload({ config })
  try {
    const doc = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })
    if (!doc) return null
    return {
      id: String(doc.id),
      email: doc.email,
      name: doc.name,
      role: (doc.role ?? 'user') as UserRole,
      status: doc.status,
      betterAuthId: doc.betterAuthId,
    }
  } catch {
    return null
  }
}

/** Mirror role/status/emailVerified onto the Better-Auth user doc (keyed by email). */
async function mirrorBetterAuthUser(email: string, fields: Record<string, unknown>): Promise<void> {
  const db = (await getMongoClient()).db()
  await db.collection('user').updateOne({ email }, { $set: fields })
}

/** Kill every live Better-Auth session for a user so deactivation takes effect. */
async function revokeSessions(betterAuthId?: string | null): Promise<void> {
  if (!betterAuthId) return
  const db = (await getMongoClient()).db()
  // The mongodb adapter stores session.userId as an ObjectId reference to
  // user._id; match both forms in case any legacy rows stored a string.
  const ids: unknown[] = [betterAuthId]
  try {
    ids.push(new ObjectId(betterAuthId))
  } catch {
    /* betterAuthId is not a valid ObjectId — the string form covers it */
  }
  await db.collection('session').deleteMany({ userId: { $in: ids } })
}

/** Count super_admins that can still sign in (used for last-super_admin guard). */
async function countActiveSuperAdmins(): Promise<number> {
  const payload = await getPayload({ config })
  const res = await payload.count({
    collection: 'users',
    where: {
      and: [{ role: { equals: 'super_admin' } }, { status: { equals: 'approved' } }],
    },
    overrideAccess: true,
  })
  return res.totalDocs
}

function randomPassword(): string {
  return crypto.randomBytes(32).toString('hex')
}

// --- createUser ---------------------------------------------------------------

interface CreateUserInput {
  name: string
  email: string
  role: UserRole
  mode: 'invite' | 'password'
  password?: string
}

export async function createUser(input: CreateUserInput): Promise<ActionResult<{ userId: string }>> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const name = input.name?.trim()
  const email = input.email?.trim().toLowerCase()
  if (!name || !email) return { ok: false, error: 'Name and email are required' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address' }

  if (!canAssignRole(actor.role, input.role)) {
    return { ok: false, error: 'You are not allowed to assign that role' }
  }

  if (input.mode === 'password') {
    if (!input.password || input.password.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters' }
    }
  }

  const payload = await getPayload({ config })

  // Reject duplicates in EITHER store before creating anything.
  const existingPayload = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  const db = (await getMongoClient()).db()
  const existingBa = await db.collection('user').findOne({ email })
  if (existingPayload.docs.length > 0 || existingBa) {
    return { ok: false, error: 'A user with this email already exists' }
  }

  const signUpPassword = input.mode === 'password' ? (input.password as string) : randomPassword()

  // 1. Create the Better-Auth account. autoSignIn is off, so this mints no
  //    session for the acting admin.
  let baUserId: string
  try {
    const signUp = await auth.api.signUpEmail({ body: { email, password: signUpPassword, name } })
    baUserId = String((signUp as { user?: { id?: string } })?.user?.id ?? '')
  } catch (err) {
    const message = (err as Error)?.message ?? ''
    if (message.includes('already exists') || message.toLowerCase().includes('exist')) {
      return { ok: false, error: 'A user with this email already exists' }
    }
    return { ok: false, error: 'Failed to create account' }
  }

  // 2. Promote the Better-Auth user to approved. Manual-password accounts are
  //    email-verified immediately (the admin vouches); invited accounts verify
  //    when they complete the invite link.
  await mirrorBetterAuthUser(email, {
    status: 'approved',
    role: input.role,
    emailVerified: input.mode === 'password',
  })

  // 3. Create the Payload mirror.
  let createdId: string
  try {
    const created = await payload.create({
      collection: 'users',
      data: {
        email,
        name,
        role: input.role,
        status: 'approved',
        betterAuthId: baUserId || undefined,
        skipEmailVerification: input.mode === 'password',
        // Local strategy is disabled; this password is never usable for login.
        password: randomPassword(),
      },
      overrideAccess: true,
      context: { skipApprovalHook: true },
    })
    createdId = String(created.id)
  } catch {
    return { ok: false, error: 'Failed to create user record' }
  }

  // 4. Invite mode: send the "set your password" link via the reset-token path.
  if (input.mode === 'invite') {
    try {
      await auth.api.requestPasswordReset({ body: { email, redirectTo: INVITE_REDIRECT } })
    } catch (err) {
      // The account exists; surface the delivery failure but do not roll back.
      console.error('[users] Failed to send invite email:', err)
    }
  }

  revalidatePath(USERS_PATH)
  return { ok: true, data: { userId: createdId } }
}

// --- updateUser ---------------------------------------------------------------

interface UpdateUserInput {
  userId: string
  name?: string
  role?: UserRole
}

export async function updateUser(input: UpdateUserInput): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(input.userId)
  if (!target) return { ok: false, error: 'User not found' }

  const roleChange = input.role !== undefined && input.role !== target.role
  const nameChange = input.name !== undefined

  // Any edit requires the actor to be allowed to manage this target at all.
  if (!canManageTarget(actor.role, target.role)) return forbidden

  if (roleChange) {
    const nextRole = input.role as UserRole
    if (actor.id === target.id) {
      return { ok: false, error: 'You cannot change your own role' }
    }
    if (!canAssignRole(actor.role, nextRole)) {
      return { ok: false, error: 'You are not allowed to assign that role' }
    }
    if (target.role === 'super_admin' && nextRole !== 'super_admin') {
      if ((await countActiveSuperAdmins()) <= 1) {
        return { ok: false, error: 'Cannot demote the last active super admin' }
      }
    }
  }

  if (!roleChange && !nameChange) return { ok: true }

  const payload = await getPayload({ config })
  const data: Record<string, unknown> = {}
  if (nameChange) data.name = input.name
  if (roleChange) data.role = input.role

  try {
    await payload.update({
      collection: 'users',
      id: target.id,
      data,
      overrideAccess: true,
      context: { skipApprovalHook: true },
    })
  } catch {
    return { ok: false, error: 'Failed to update user' }
  }

  if (roleChange) {
    await mirrorBetterAuthUser(target.email, { role: input.role })
  }

  revalidatePath(USERS_PATH)
  return { ok: true }
}

// --- approve / reject ---------------------------------------------------------

export async function approveUser(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (!canManageTarget(actor.role, target.role)) return forbidden
  if (target.status !== 'pending') return { ok: false, error: 'User is not pending approval' }

  const payload = await getPayload({ config })
  try {
    // Go through the normal approval hook (no skipApprovalHook) so the existing
    // verification-email pipeline fires and the Better-Auth mirror is updated.
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { status: 'approved' },
      overrideAccess: true,
      user: actor,
    })
  } catch {
    return { ok: false, error: 'Failed to approve user' }
  }

  revalidatePath(USERS_PATH)
  return { ok: true }
}

export async function rejectUser(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (!canManageTarget(actor.role, target.role)) return forbidden
  if (target.status !== 'pending') return { ok: false, error: 'User is not pending approval' }

  const payload = await getPayload({ config })
  try {
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { status: 'rejected' },
      overrideAccess: true,
      user: actor,
    })
  } catch {
    return { ok: false, error: 'Failed to reject user' }
  }

  revalidatePath(USERS_PATH)
  return { ok: true }
}

// --- deactivate / reactivate --------------------------------------------------

export async function deactivateUser(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (actor.id === target.id) return { ok: false, error: 'You cannot deactivate your own account' }
  if (!canManageTarget(actor.role, target.role)) return forbidden
  if (target.status === 'deactivated') return { ok: false, error: 'User is already deactivated' }
  if (target.role === 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
    return { ok: false, error: 'Cannot deactivate the last active super admin' }
  }

  const payload = await getPayload({ config })
  try {
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { status: 'deactivated' },
      overrideAccess: true,
      context: { skipApprovalHook: true },
    })
  } catch {
    return { ok: false, error: 'Failed to deactivate user' }
  }

  await mirrorBetterAuthUser(target.email, { status: 'deactivated' })
  await revokeSessions(target.betterAuthId)

  revalidatePath(USERS_PATH)
  return { ok: true }
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (!canManageTarget(actor.role, target.role)) return forbidden
  if (target.status !== 'deactivated') return { ok: false, error: 'User is not deactivated' }

  const payload = await getPayload({ config })
  try {
    await payload.update({
      collection: 'users',
      id: target.id,
      data: { status: 'approved' },
      overrideAccess: true,
      context: { skipApprovalHook: true },
    })
  } catch {
    return { ok: false, error: 'Failed to reactivate user' }
  }

  await mirrorBetterAuthUser(target.email, { status: 'approved' })

  revalidatePath(USERS_PATH)
  return { ok: true }
}

// --- email utilities ----------------------------------------------------------

async function findBaUser(email: string) {
  const db = (await getMongoClient()).db()
  return db.collection('user').findOne({ email })
}

export async function resendVerification(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (!canManageTarget(actor.role, target.role)) return forbidden

  const baUser = await findBaUser(target.email)
  if (baUser?.emailVerified) {
    return { ok: false, error: 'This user has already verified their email' }
  }

  try {
    await auth.api.sendVerificationEmail({ body: { email: target.email, callbackURL: '/login' } })
  } catch {
    return { ok: false, error: 'Failed to send verification email' }
  }
  return { ok: true }
}

export async function sendPasswordReset(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (!canManageTarget(actor.role, target.role)) return forbidden

  try {
    await auth.api.requestPasswordReset({ body: { email: target.email, redirectTo: RESET_REDIRECT } })
  } catch {
    return { ok: false, error: 'Failed to send password reset email' }
  }
  return { ok: true }
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin()
  if (!actor) return forbidden

  const target = await loadTarget(userId)
  if (!target) return { ok: false, error: 'User not found' }
  if (!canManageTarget(actor.role, target.role)) return forbidden

  const baUser = await findBaUser(target.email)
  if (baUser?.emailVerified) {
    return { ok: false, error: 'This user has already accepted their invite' }
  }

  try {
    await auth.api.requestPasswordReset({ body: { email: target.email, redirectTo: INVITE_REDIRECT } })
  } catch {
    return { ok: false, error: 'Failed to send invite email' }
  }
  return { ok: true }
}
