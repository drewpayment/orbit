/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  // Apps -> userApprovalHook -> lib/mongodb requires it at import (lazy connect).
  process.env.DATABASE_URI ??= 'mongodb://localhost:27017/test'
})

vi.mock('@payload-config', () => ({ default: {} }))

import type { CollectionConfig, Field } from 'payload'
import { CloudAccounts } from '../CloudAccounts'
import { LLMProviders } from '../LLMProviders'
import { Templates } from '../Templates'
import { Apps } from '../Apps'
import { KafkaClusters } from '../kafka/KafkaClusters'
import { GitHubInstallations } from '../GitHubInstallations'
import { GitConnections } from '../connections/GitConnections'
import { RegistryConfigs } from '../RegistryConfigs'
import { buildConfig, beforeChangeTraverseFields } from 'payload'
import {
  isEncryptedEnvelope,
  isEncryptedJson,
  decryptSecretString,
  decryptSecretJson,
} from '@/lib/encryption/secret-fields'
import { encrypt } from '@/lib/encryption'

/** Resolve a (possibly dotted) field path inside a collection's field tree. */
function findField(fields: Field[], path: string): Field & Record<string, any> {
  const [head, ...rest] = path.split('.')
  const f = fields.find((x) => 'name' in x && x.name === head) as any
  if (!f) throw new Error(`field ${head} not found`)
  return rest.length ? findField(f.fields, rest.join('.')) : f
}

// collection, field path, sample plaintext
const SECRET_FIELDS: Array<[CollectionConfig, string, unknown]> = [
  [CloudAccounts, 'credentials', { apiToken: 'dop_v1_secret' }],
  [LLMProviders, 'apiKey', 'sk-ant-secret'],
  [Templates, 'webhookSecret', 'whsec_template'],
  [Apps, 'webhookSecret', 'whsec_app'],
  [KafkaClusters, 'credentials', { 'sasl.password': 'kafka-secret' }],
  [GitHubInstallations, 'installationToken', 'ghs_secret'],
  [GitConnections, 'credentials.pat', 'ado-pat-secret'],
  [GitConnections, 'credentials.clientSecret', 'entra-secret'],
]


/** Top-level field name that holds (or contains) the secret. */
const topName = (path: string) => path.split('.')[0]

/**
 * Run the REAL Payload beforeChange traverse (field hooks -> json parse ->
 * sanitized `validate`) for one secret field. The real field config (hooks,
 * access, validate, type) is copied into a synthetic one-field collection so
 * we don't need the relation targets / editors of the full collection.
 */
let realConfig: Awaited<ReturnType<typeof buildConfig>>
async function getConfig() {
  if (realConfig) return realConfig
  const collections = SECRET_FIELDS.map(([c, path], i) => {
    const f = findField(c.fields, topName(path))
    const copy: any = { ...f }
    if (copy.fields) copy.fields = copy.fields.map((x: any) => ({ ...x }))
    // required would only exercise Payload's presence check; keep it as configured
    return { slug: `probe-${i}`, fields: [copy] }
  })
  realConfig = await buildConfig({
    secret: 'test',
    db: (() => ({ defaultIDType: 'text', init: () => ({}) })) as any,
    collections,
  } as any)
  return realConfig
}

async function runBeforeChange(
  index: number,
  data: Record<string, any>,
  doc: Record<string, any> = {},
  operation: 'create' | 'update' = 'create',
) {
  const config = await getConfig()
  const col = config.collections.find((c) => c.slug === `probe-${index}`)!
  const errors: any[] = []
  const incoming = structuredClone(data)
  await beforeChangeTraverseFields({
    collection: col,
    context: {},
    data: incoming,
    doc,
    docWithLocales: doc,
    errors,
    fieldLabelPath: '',
    fields: col.fields,
    mergeLocaleActions: [],
    operation,
    overrideAccess: true,
    parentIndexPath: '',
    parentIsLocalized: false,
    parentPath: '',
    parentSchemaPath: '',
    // admin user: CloudAccounts.credentials has an admin.condition that skips
    // validation for non-admins, which would hide validation failures.
    req: { t: (k: string) => k, payload: { config }, context: {}, user: { id: 'a1', role: 'super_admin' } } as any,
    siblingData: incoming,
    siblingDoc: doc,
    siblingDocWithLocales: doc,
    skipValidation: false,
  } as any)
  return { data: incoming, errors }
}

const getAt = (obj: any, path: string) => path.split('.').reduce((a, k) => a?.[k], obj)
const nest = (path: string, v: unknown) =>
  path.split('.').reduceRight<any>((acc, k) => ({ [k]: acc }), v)

describe.each(SECRET_FIELDS.map((f, i) => [i, ...f] as const))('%#: secret field', (i, collection, path, sample) => {
  const label = `${collection.slug}.${path}`
  const isJson = typeof sample === 'object'

  it(`${label}: API read access is denied to every caller`, async () => {
    const field = findField(collection.fields, path)
    expect(field.access?.read, 'field-level read access must be defined').toBeTypeOf('function')
    for (const req of [
      { user: undefined },
      { user: { id: 'u1', role: 'user' } },
      { user: { id: 'a1', role: 'super_admin' } },
    ]) {
      expect(await field.access.read({ req, id: '1', siblingData: {}, data: {} })).toBe(false)
    }
  })

  it(`${label}: real Payload validation accepts the value and it is stored encrypted`, async () => {
    const { data, errors } = await runBeforeChange(i, nest(path, sample))
    expect(errors, 'Payload validation errors').toEqual([])
    const stored = getAt(data, path)

    if (isJson) {
      expect(isEncryptedJson(stored)).toBe(true)
      expect(decryptSecretJson(stored)).toEqual(sample)
    } else {
      expect(isEncryptedEnvelope(stored)).toBe(true)
      expect(decryptSecretString(stored)).toBe(sample)
    }
    expect(JSON.stringify(stored)).not.toContain(
      typeof sample === 'string' ? sample : (Object.values(sample as object)[0] as string),
    )

    // Re-saving the stored value (update, previousValue === value) is a no-op.
    const again = await runBeforeChange(i, nest(path, stored), nest(path, stored), 'update')
    expect(again.errors).toEqual([])
    expect(getAt(again.data, path)).toEqual(stored)
  })

  it(`${label}: a caller-supplied ciphertext is re-encrypted, never trusted`, async () => {
    const trusting = collection.slug === 'github-installations' // admin-only, writers pre-encrypt
    const victim = isJson ? { enc: encrypt(JSON.stringify({ apiToken: 'victim' })) } : encrypt('victim-secret')
    const { data, errors } = await runBeforeChange(i, nest(path, victim), nest(path, undefined), 'update')
    expect(errors).toEqual([])
    const stored = getAt(data, path)
    if (trusting) {
      expect(stored).toEqual(victim)
      return
    }
    expect(stored).not.toEqual(victim)
    // one decryption layer only reveals the victim's ciphertext, not its plaintext
    if (isJson) expect(decryptSecretJson(stored)).toEqual(victim)
    else expect(decryptSecretString(stored)).toBe(victim)
  })
})

describe('already-protected fields stay protected', () => {
  it('registry-configs secrets remain read-denied', () => {
    expect(findField(RegistryConfigs.fields, 'ghcrPat').access?.read?.({} as never)).toBe(false)
    expect(findField(RegistryConfigs.fields, 'acrToken').access?.read?.({} as never)).toBe(false)
  })
})
