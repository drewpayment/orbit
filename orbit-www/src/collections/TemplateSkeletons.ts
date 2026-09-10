// orbit-www/src/collections/TemplateSkeletons.ts
import type { CollectionConfig } from 'payload'
import { workspaceScopedRead, memberCreate, docWorkspaceMutate } from '@/lib/access/collection-access'
import { validateSkeletonBundleHook } from './hooks/validate-skeleton-bundle'
import { skeletonVersionBumpHook } from './hooks/skeleton-version-bump'

/**
 * TemplateSkeletons — Orbit-hosted "create from scratch without git" file
 * bundles (In-App Template Authoring Phase 3, design §3.5,
 * docs/plans/2026-09-10-template-authoring-phase-3-greenfield-content.md
 * §2.1). Consumed by the `fetch:orbit-skeleton` scaffolder action via the
 * internal fetch route at `/api/internal/template-skeletons/[id]`.
 *
 * Storage decision (plan §2.1, lead decision §7.1): file content is stored
 * INLINE in the Payload document, not in MinIO — orbit-www has no S3/MinIO
 * client today, and the bundle caps (<=50 files, <=1MB total, text-only)
 * comfortably fit a MongoDB document. This deviates from the parent design
 * doc's "bundle stored in MinIO" framing; flagged as a deliberate scope-fit
 * decision, not an oversight.
 *
 * RBAC (lead decision §7.2): edit is owner/admin only, matching
 * `TemplateDefinitions`, since a skeleton feeds directly into what a
 * template produces. Read is any active workspace member.
 *
 * `version` is a plain optimistic-concurrency/cache-bust counter bumped on
 * every save — NOT a version history like `template-definition-versions`.
 * A single mutable row is enough for v1.
 */
export const TemplateSkeletons: CollectionConfig = {
  slug: 'template-skeletons',
  admin: {
    useAsTitle: 'name',
    group: 'Self-Service',
    defaultColumns: ['name', 'slug', 'workspace', 'totalSize', 'version'],
    description: 'Orbit-hosted file bundles authored in-app for the fetch:orbit-skeleton action.',
  },
  access: {
    read: workspaceScopedRead(),
    create: memberCreate(),
    update: docWorkspaceMutate('template-skeletons', ['owner', 'admin']),
    delete: docWorkspaceMutate('template-skeletons', ['owner', 'admin']),
  },
  hooks: {
    beforeValidate: [validateSkeletonBundleHook],
    beforeChange: [skeletonVersionBumpHook],
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      minLength: 3,
      maxLength: 100,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !/^[a-z0-9-]+$/.test(val)) {
          return 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      name: 'description',
      type: 'textarea',
      maxLength: 2000,
    },
    {
      name: 'files',
      type: 'array',
      required: true,
      minRows: 1,
      admin: {
        description: 'At most 50 files, 1 MB total (UTF-8 bytes), text-only. Enforced server-side.',
      },
      fields: [
        {
          name: 'path',
          type: 'text',
          required: true,
          admin: {
            description: 'Relative path within the bundle, e.g. "src/index.ts". No leading "/", no ".." segments.',
          },
        },
        {
          name: 'content',
          type: 'textarea',
          required: true,
        },
        {
          name: 'size',
          type: 'number',
          admin: {
            readOnly: true,
            description: 'UTF-8 byte length of content, computed server-side.',
          },
        },
        {
          name: 'isBinary',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            readOnly: true,
            description: 'Always false in v1 — binary files are out of scope. Kept for forward compat.',
          },
        },
      ],
    },
    {
      name: 'version',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: 'Optimistic-concurrency/cache-bust counter, bumped on every save. Not a history.',
      },
    },
    {
      name: 'totalSize',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Sum of files[].size, computed server-side.',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    },
  ],
  indexes: [{ fields: ['workspace', 'slug'], unique: true }],
  timestamps: true,
}
