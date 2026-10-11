import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

import {
  SECRET_TARGETS,
  migrateTarget,
  type SecretTarget,
  type MigratableCollection,
} from './migrate-encrypt-secrets'
import {
  encryptSecretValue,
  encryptSecretJson,
  isEncryptedEnvelope,
  isEncryptedJson,
  decryptSecretString,
  decryptSecretJson,
} from '../lib/encryption/secret-fields'

type Doc = Record<string, any>

/** Minimal in-memory stand-in for a Mongo collection (dot-path $set, guarded filters). */
function fakeCollection(docs: Doc[]): MigratableCollection & { docs: Doc[]; updates: number } {
  const get = (d: Doc, path: string) => path.split('.').reduce((a: any, k) => a?.[k], d)
  const set = (d: Doc, path: string, v: unknown) => {
    const keys = path.split('.')
    let cur = d
    for (const k of keys.slice(0, -1)) cur = cur[k]
    cur[keys[keys.length - 1]] = v
  }
  const self = {
    docs,
    updates: 0,
    find(filter: Doc) {
      const [path] = Object.keys(filter)
      return {
        toArray: async () =>
          docs.filter((d) => {
            const v = get(d, path)
            return v !== undefined && v !== null && v !== ''
          }),
      }
    },
    async updateOne(filter: Doc, update: Doc) {
      const target = docs.find((d) => d._id === filter._id)!
      const [path, expected] = Object.entries(filter).find(([k]) => k !== '_id')!
      if (JSON.stringify(get(target, path)) !== JSON.stringify(expected)) return { modifiedCount: 0 }
      for (const [p, v] of Object.entries(update.$set)) set(target, p, v)
      self.updates++
      return { modifiedCount: 1 }
    },
  }
  return self as any
}

const text: SecretTarget = { collection: 'llm-providers', path: 'apiKey', kind: 'text' }
const json: SecretTarget = { collection: 'cloud-accounts', path: 'credentials', kind: 'json' }
const nested: SecretTarget = { collection: 'git-connections', path: 'credentials.pat', kind: 'text' }

describe('migrateTarget', () => {
  it('encrypts plaintext text fields and leaves ciphertext/empty values alone', async () => {
    const already = encryptSecretValue('already') as string
    const c = fakeCollection([
      { _id: 1, apiKey: 'sk-plain' },
      { _id: 2, apiKey: already },
      { _id: 3, apiKey: '' },
      { _id: 4 },
    ])
    const r = await migrateTarget(c, text, { apply: true })
    expect(r).toMatchObject({ scanned: 2, encrypted: 1, alreadyEncrypted: 1, errors: 0 })
    expect(isEncryptedEnvelope(c.docs[0].apiKey)).toBe(true)
    expect(decryptSecretString(c.docs[0].apiKey)).toBe('sk-plain')
    expect(c.docs[1].apiKey).toBe(already)
  })

  it('encrypts plaintext that contains colons (not mistaken for ciphertext)', async () => {
    const c = fakeCollection([{ _id: 1, apiKey: 'a:b:c' }])
    await migrateTarget(c, text, { apply: true })
    expect(decryptSecretString(c.docs[0].apiKey)).toBe('a:b:c')
  })

  it('stores json (object) fields as an { enc } wrapper and leaves empty/encrypted ones alone', async () => {
    const wrapped = encryptSecretJson({ a: 1 })
    const c = fakeCollection([
      { _id: 1, credentials: { apiToken: 'dop_v1_x' } },
      { _id: 2, credentials: {} },
      { _id: 3, credentials: wrapped },
    ])
    const r = await migrateTarget(c, json, { apply: true })
    expect(r).toMatchObject({ encrypted: 1, alreadyEncrypted: 1, errors: 0 })
    expect(isEncryptedJson(c.docs[0].credentials)).toBe(true)
    expect(decryptSecretJson(c.docs[0].credentials)).toEqual({ apiToken: 'dop_v1_x' })
    expect(c.docs[1].credentials).toEqual({})
    expect(c.docs[2].credentials).toBe(wrapped)
  })

  it('converts a bare envelope string in a json field to the { enc } wrapper after verifying it', async () => {
    const bare = encryptSecretValue(JSON.stringify({ apiToken: 'x' })) as string
    const c = fakeCollection([{ _id: 1, credentials: bare }])
    const r = await migrateTarget(c, json, { apply: true })
    expect(r).toMatchObject({ encrypted: 1, errors: 0 })
    expect(c.docs[0].credentials).toEqual({ enc: bare })
    expect(decryptSecretJson(c.docs[0].credentials)).toEqual({ apiToken: 'x' })
  })

  it('leaves a bare envelope that does not decrypt to JSON untouched and counts an error', async () => {
    const notJson = encryptSecretValue('just-a-string') as string
    const corrupt = notJson.slice(0, -2) + (notJson.endsWith('00') ? 'ff' : '00')
    const c = fakeCollection([{ _id: 1, credentials: notJson }, { _id: 2, credentials: corrupt }])
    const r = await migrateTarget(c, json, { apply: true })
    expect(r).toMatchObject({ encrypted: 0, errors: 2 })
    expect(c.docs[0].credentials).toBe(notJson)
    expect(c.docs[1].credentials).toBe(corrupt)
  })

  it('handles nested dot paths', async () => {
    const c = fakeCollection([{ _id: 1, credentials: { pat: 'ado-pat', tenantId: 't' } }])
    await migrateTarget(c, nested, { apply: true })
    expect(decryptSecretString(c.docs[0].credentials.pat)).toBe('ado-pat')
    expect(c.docs[0].credentials.tenantId).toBe('t')
  })

  it('dry-run reports but never writes', async () => {
    const c = fakeCollection([{ _id: 1, apiKey: 'sk-plain' }])
    const r = await migrateTarget(c, text, { apply: false })
    expect(r.encrypted).toBe(1)
    expect(c.updates).toBe(0)
    expect(c.docs[0].apiKey).toBe('sk-plain')
  })

  it('is idempotent: a second run changes nothing', async () => {
    const c = fakeCollection([{ _id: 1, apiKey: 'sk-plain' }])
    await migrateTarget(c, text, { apply: true })
    const snapshot = c.docs[0].apiKey
    const r2 = await migrateTarget(c, text, { apply: true })
    expect(r2).toMatchObject({ encrypted: 0, alreadyEncrypted: 1 })
    expect(c.docs[0].apiKey).toBe(snapshot)
  })

  it('skips (and counts) a json field holding an unexpected plain string', async () => {
    const c = fakeCollection([{ _id: 1, credentials: 'not-json-and-not-ciphertext' }])
    const r = await migrateTarget(c, json, { apply: true })
    expect(r).toMatchObject({ encrypted: 0, errors: 1 })
    expect(c.docs[0].credentials).toBe('not-json-and-not-ciphertext')
  })

  it('never includes secret values in its report', async () => {
    const c = fakeCollection([{ _id: 1, apiKey: 'sk-SUPER-SECRET' }])
    const r = await migrateTarget(c, text, { apply: true })
    expect(JSON.stringify(r)).not.toContain('SUPER-SECRET')
  })
})

describe('SECRET_TARGETS', () => {
  it('covers every secret field the collections now encrypt', () => {
    const keys = SECRET_TARGETS.map((t) => `${t.collection}.${t.path}`).sort()
    expect(keys).toEqual(
      [
        'apps.webhookSecret',
        'cloud-accounts.credentials',
        'git-connections.credentials.clientSecret',
        'git-connections.credentials.pat',
        'github-installations.installationToken',
        'kafka-clusters.credentials',
        'llm-providers.apiKey',
        'templates.webhookSecret',
      ].sort(),
    )
  })
})
