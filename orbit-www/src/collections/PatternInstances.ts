import type { CollectionConfig } from 'payload'
import {
  workspaceScopedRead,
  memberCreate,
  docWorkspaceMutate,
} from '@/lib/access/collection-access'

/**
 * PatternInstances Collection
 *
 * What a workspace actually provisions from the platform-wide Patterns
 * catalog. Workspace-scoped (security enclave applies here even though
 * Patterns themselves are platform-wide); one row per provisioned
 * resource. Status walks pending → validating → provisioning →
 * active|failed and (later) deprovisioning → deprovisioned.
 *
 * For v1, instances are created and executed inline by the agent's
 * instantiate_pattern dispatch. The workflowId field holds the agent
 * run's workflow id so the audit trail can stitch row ↔ chat. A
 * follow-up spike will move long-running instances into a dedicated
 * PatternInstantiationWorkflow without changing this schema.
 *
 * See plans/merry-strolling-bumblebee.md (Phase 3 of the Patterns
 * catalog spike).
 */
export const PatternInstances: CollectionConfig = {
  slug: 'pattern-instances',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'workspace', 'pattern', 'status', 'updatedAt'],
    description: 'Provisioned instances of platform Patterns within a workspace',
    group: 'Agent',
  },
  access: {
    // Read: platform admin sees all; workspace members see their own.
    read: workspaceScopedRead(),
    // Create: any active member of the target `data.workspace`; workspace
    // membership is checked via the agent dispatch + the workspace field.
    // Direct user-driven creation from a future browse UI follows the same path.
    create: memberCreate(),
    // Update: workspace owner/admin/member. Status writebacks from the
    // temporal worker go through /api/internal/pattern-instances/[id]/
    // status with X-API-Key, bypassing this access check.
    update: docWorkspaceMutate('pattern-instances', ['owner', 'admin', 'member']),
    // Delete: workspace owner/admin only.
    delete: docWorkspaceMutate('pattern-instances', ['owner', 'admin']),
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      admin: { description: 'Security enclave the instance belongs to.' },
    },
    {
      name: 'pattern',
      type: 'relationship',
      relationTo: 'patterns',
      required: true,
      admin: { description: 'Catalog entry this instance was provisioned from.' },
    },
    {
      name: 'patternVersion',
      type: 'number',
      required: true,
      admin: {
        description:
          "Snapshot of patterns.currentVersion at instantiation time. A later pattern edit doesn't retroactively change a live instance.",
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Human name within the workspace (unique per workspace).' },
    },
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      admin: {
        description:
          'Optional binding to an App — set for instances that belong to a specific app (e.g. "Postgres for myapp"); blank for standalone resources.',
      },
    },
    {
      name: 'parameters',
      type: 'json',
      required: true,
      admin: {
        description:
          "User-supplied args. Must validate against the snapshot pattern's inputSchemaJson at instantiation time.",
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Validating parameters', value: 'validating' },
        { label: 'Provisioning', value: 'provisioning' },
        { label: 'Active', value: 'active' },
        { label: 'Failed', value: 'failed' },
        { label: 'Deprovisioning', value: 'deprovisioning' },
        { label: 'Deprovisioned', value: 'deprovisioned' },
      ],
    },
    {
      name: 'workflowId',
      type: 'text',
      admin: {
        readOnly: true,
        description:
          'Temporal workflow id that provisioned this instance. For v1 this is the agent run id; future iterations move long-running instances into a dedicated PatternInstantiationWorkflow under id `pattern-instance-{id}`.',
      },
    },
    {
      name: 'outputs',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'What the template produced (urls, ids, etc.). Populated on transition to active.',
      },
    },
    {
      name: 'errorMessage',
      type: 'textarea',
      admin: { readOnly: true, description: 'Populated on transition to failed.' },
    },
    {
      name: 'createdByUser',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    },
    {
      name: 'createdByRunId',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Agent run id that created the instance, if any.',
      },
    },
  ],
  indexes: [
    { fields: ['workspace', 'name'], unique: true },
    { fields: ['workspace', 'pattern'] },
    { fields: ['workspace', 'status'] },
  ],
  timestamps: true,
}
