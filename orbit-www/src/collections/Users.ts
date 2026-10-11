import type { CollectionConfig } from 'payload'
import { userApprovalAfterChangeHook } from './hooks/userApprovalHook'
import { betterAuthStrategy } from '@/lib/payload-better-auth-strategy'
import {
  adminOrSelfFieldRead,
  privilegedFieldCreate,
  privilegedFieldUpdate,
  superAdminFieldWrite,
  usersCreate,
  usersDelete,
  usersRead,
  usersUpdate,
} from '@/lib/authz/users'

// Field access shared by privilege / approval fields. See lib/authz/users.ts.
const privilegedAccess = (options: { assignsRole?: boolean } = {}) => ({
  create: privilegedFieldCreate(options),
  update: privilegedFieldUpdate(options),
})

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  access: {
    create: usersCreate,
    read: usersRead,
    update: usersUpdate,
    delete: usersDelete,
    admin: ({ req }) => {
      const role = req.user?.role
      // A deactivated admin must lose the /admin panel immediately, not on
      // session-cookie-cache expiry. req.user comes from betterAuthStrategy,
      // which resolves status from a fresh Payload read.
      if (req.user?.status === 'deactivated') return false
      // The Payload admin panel is the escape hatch around all app-level policy
      // (raw collection edits, no policy matrix) — super_admin only.
      return role === 'super_admin'
    },
  },
  auth: {
    disableLocalStrategy: { enableFields: true },
    strategies: [betterAuthStrategy],
  },
  hooks: {
    afterChange: [
      async (args) => {
        if (args.context?.skipApprovalHook) return args.doc
        return userApprovalAfterChangeHook(args)
      },
    ],
  },
  // Access notes: REST/GraphQL edits by a super_admin bypass the invariants the
  // /platform/users server actions enforce (last-super_admin guard, the
  // Better-Auth mirror in mirrorBetterAuthUser). Prefer the /platform/users UI
  // over raw collection edits in /admin or /api/users.
  fields: [
    {
      // Merged over Payload's built-in auth email field (keeps its unique /
      // lowercase / validate behaviour). Identity is resolved by email
      // (ensurePayloadUser, platform actions, approval hook), so an editable
      // email lets a user retarget their doc onto a pending invitee or orphaned
      // Better-Auth account. Changes go through Better-Auth; REST updates are
      // super_admin only.
      name: 'email',
      type: 'email',
      access: { update: superAdminFieldWrite },
    },
    {
      name: 'name',
      type: 'text',
      label: 'Full Name',
    },
    {
      name: 'avatar',
      type: 'upload',
      relationTo: 'media',
      label: 'Profile Picture',
    },
    {
      name: 'status',
      access: {
        ...privilegedAccess(),
        read: adminOrSelfFieldRead,
      },
      type: 'select',
      label: 'Registration Status',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Deactivated', value: 'deactivated' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Change to "Approved" to allow this user to log in.',
      },
    },
    {
      name: 'role',
      access: {
        ...privilegedAccess({ assignsRole: true }),
        read: adminOrSelfFieldRead,
      },
      type: 'select',
      label: 'User Role',
      defaultValue: 'user',
      options: [
        { label: 'Super Admin', value: 'super_admin' },
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Super Admin and Admin can access the Payload admin panel.',
      },
    },
    {
      name: 'betterAuthId',
      // super_admin only: rewriting it would point an account at another user's
      // Better-Auth identity and inherit their workspace memberships. System
      // flows (ensurePayloadUser, invite) write it via the Local API.
      access: {
        create: superAdminFieldWrite,
        update: superAdminFieldWrite,
      },
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Better Auth user ID — auto-populated on first login',
      },
    },
    {
      name: 'skipEmailVerification',
      access: {
        ...privilegedAccess(),
        read: adminOrSelfFieldRead,
      },
      type: 'checkbox',
      label: 'Skip Email Verification',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'If checked, user can log in immediately after approval without verifying their email.',
        condition: (data) => data?.status === 'approved',
      },
    },
    {
      name: 'invitedAt',
      access: {
        ...privilegedAccess(),
        read: adminOrSelfFieldRead,
      },
      type: 'date',
      label: 'Invited At',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Set when an admin creates this user via an invite link; distinguishes invited users from self-registered ones.',
      },
    },
    {
      name: 'registrationApprovedAt',
      access: {
        ...privilegedAccess(),
        read: adminOrSelfFieldRead,
      },
      type: 'date',
      label: 'Approved At',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'registrationApprovedBy',
      access: {
        ...privilegedAccess(),
        read: adminOrSelfFieldRead,
      },
      type: 'relationship',
      relationTo: 'users',
      label: 'Approved By',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
  ],
}
