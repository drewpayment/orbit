import type { Action } from '@/payload-types'

/**
 * Backend-type metadata for the Action authoring form (IDP refocus P3).
 *
 * PURE + client-safe: no 'use server', no Payload/collection imports, so both
 * the client `BackendConfigFields` and the server authoring actions can share
 * one source of truth for the allowed `backend.type` values and how each type's
 * `ref` is labelled. The list mirrors `ACTION_BACKEND_TYPES` in
 * `src/collections/actions/Actions.ts`; the `satisfies` + exhaustiveness check
 * below turns any drift (a type added to the collection union) into a compile
 * error here.
 */

type BackendType = Action['backend']['type']

export const ACTION_BACKEND_TYPES = [
  'builtin',
  'webhook',
  'temporal-template',
  'temporal-pattern',
  'temporal-launch',
  'kafka-provision',
  'agent',
] as const satisfies readonly BackendType[]

// Compile-time guard: fails if the collection union gains a type not listed above.
type _MissingBackendType = Exclude<BackendType, (typeof ACTION_BACKEND_TYPES)[number]>
const _exhaustive: _MissingBackendType extends never ? true : never = true
void _exhaustive

export interface BackendTypeMeta {
  value: BackendType
  label: string
  /** Label for the `ref` input, adapted to the backend type. */
  refLabel: string
  /** Helper text under the `ref` input. */
  refHelp: string
  refPlaceholder?: string
  /**
   * True when this backend is not yet executed by the runner (dispatched by the
   * deferred Go ActionDispatch workflow). The form surfaces a "deferred" note.
   */
  deferred: boolean
}

export const BACKEND_TYPE_META: Record<BackendType, BackendTypeMeta> = {
  builtin: {
    value: 'builtin',
    label: 'Built-in handler',
    refLabel: 'Handler id',
    refHelp: 'The id of a built-in handler, e.g. register-service.',
    refPlaceholder: 'register-service',
    deferred: false,
  },
  webhook: {
    value: 'webhook',
    label: 'Webhook',
    refLabel: 'POST URL',
    refHelp: 'The URL this action POSTs the collected inputs to.',
    refPlaceholder: 'https://example.com/hooks/provision',
    deferred: false,
  },
  'temporal-template': {
    value: 'temporal-template',
    label: 'Temporal — template',
    refLabel: 'Template id',
    refHelp: 'The template/workflow id to scaffold from. Not yet executed (deferred).',
    refPlaceholder: 'go-service-template',
    deferred: true,
  },
  'temporal-pattern': {
    value: 'temporal-pattern',
    label: 'Temporal — pattern',
    refLabel: 'Pattern id',
    refHelp: 'The pattern/workflow id to apply. Not yet executed (deferred).',
    refPlaceholder: 'event-driven-pattern',
    deferred: true,
  },
  'temporal-launch': {
    value: 'temporal-launch',
    label: 'Temporal — launch',
    refLabel: 'Launch id',
    refHelp: 'The cloud-launch workflow id to run. Not yet executed (deferred).',
    refPlaceholder: 'digitalocean-launch',
    deferred: true,
  },
  'kafka-provision': {
    value: 'kafka-provision',
    label: 'Kafka provisioning',
    refLabel: 'Topic config',
    refHelp: 'The topic/provisioning config reference. Not yet executed (deferred).',
    refPlaceholder: 'orders.v1',
    deferred: true,
  },
  agent: {
    value: 'agent',
    label: 'Infra agent',
    refLabel: 'Prompt ref',
    refHelp: 'The agent prompt reference to drive. Not yet executed (deferred).',
    refPlaceholder: 'provision-namespace',
    deferred: true,
  },
}

/** Ordered metadata list for rendering the backend-type <select>. */
export const BACKEND_TYPE_OPTIONS: BackendTypeMeta[] = ACTION_BACKEND_TYPES.map(
  (t) => BACKEND_TYPE_META[t],
)

/** Type guard: is `value` a known backend type? (used server-side before save). */
export function isBackendType(value: unknown): value is BackendType {
  return typeof value === 'string' && (ACTION_BACKEND_TYPES as readonly string[]).includes(value)
}
