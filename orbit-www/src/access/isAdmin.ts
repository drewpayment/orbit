import type { Access } from 'payload'

/**
 * Payload access control: allows only super_admin and admin users.
 */
export const isAdmin: Access = ({ req: { user } }) => {
  if (!user) return false
  const role = (user as any).role
  return role === 'super_admin' || role === 'admin'
}
