import type { CollectionBeforeChangeHook } from 'payload'

/**
 * `template-skeletons` `beforeChange` hook: bumps `version` and pins
 * `createdBy` from server-trusted state, never from client-supplied `data`.
 *
 * `admin.readOnly` on these fields is UI-only — it does not stop a direct
 * API/PATCH call from sending `version` or `createdBy` in the body. Deriving
 * `version` from `originalDoc?.version` (not `data.version`) and pinning
 * `createdBy` to `originalDoc?.createdBy` on update closes that gap: a
 * caller can never spoof either field.
 *
 *  - create: `version` is always `1`; `createdBy` is the requesting user.
 *  - update: `version` is `(originalDoc?.version ?? 0) + 1`; `createdBy` is
 *    always `originalDoc?.createdBy`, regardless of what `data` sent.
 */
export const skeletonVersionBumpHook: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  if (operation === 'create') {
    return {
      ...data,
      version: 1,
      createdBy: req.user?.id,
    }
  }

  const previousVersion = typeof originalDoc?.version === 'number' ? originalDoc.version : 0
  return {
    ...data,
    version: previousVersion + 1,
    createdBy: originalDoc?.createdBy,
  }
}
