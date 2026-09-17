/**
 * Compatibility shim. The composable Payload `Access` factories now live in
 * `@/lib/authz/payload` (authz consolidation Phase B,
 * docs/plans/2026-09-16-authz-consolidation.md). Signatures are unchanged so
 * existing collections keep importing from here; new code should import from
 * `@/lib/authz/payload` directly.
 */
export {
  adminOnly,
  workspaceScopedRead,
  memberCreate,
  manageCreate,
  docWorkspaceMutate,
  type WorkspaceScopedReadOptions,
  type CreateAccessOptions,
  type DocMutateOptions,
  type DataWorkspaceResolver,
  type DocWorkspaceResolver,
} from '@/lib/authz/payload'
