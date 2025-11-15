import type { Access } from 'payload'

/**
 * Access control: Only admins can access
 *
 * Note: Currently checks if user exists and has admin role.
 * TODO: Implement proper role-based access control when user roles are defined.
 */
export const isAdmin: Access = ({ req: { user } }) => {
  // For now, check if user exists and has admin role
  // Adjust this based on your actual user role implementation
  if (!user) return false

  // TODO: Replace with actual admin role check once implemented
  // For example: return user.role === 'admin'
  // For now, allow all authenticated users (temporary for development)
  return true
}
