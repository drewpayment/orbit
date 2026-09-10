/**
 * @vitest-environment node
 *
 * Unit tests against a hand-rolled Payload mock (mirrors
 * src/lib/access/__tests__/collection-access.test.ts). A live-Mongo
 * integration run was not possible in this environment (no Docker Mongo
 * reachable on :27017); these exercise the same call graph the route
 * handlers hit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import { createDraftVersion, publishVersion, deprecateDefinition } from '../versions'

/* eslint-disable @typescript-eslint/no-explicit-any */
function makePayload(opts: {
  definitions?: Record<string, any>
  versions?: Record<string, any>
  actionRuns?: Record<string, any>
  existingVersionNumbers?: Record<string, number[]>
}) {
  const definitions = opts.definitions ?? {}
  const versions = opts.versions ?? {}
  const actionRuns = opts.actionRuns ?? {}
  const existingVersionNumbers = opts.existingVersionNumbers ?? {}

  const findByID = vi.fn(async (args: any) => {
    const store =
      args.collection === 'template-definitions'
        ? definitions
        : args.collection === 'template-definition-versions'
          ? versions
          : args.collection === 'action-runs'
            ? actionRuns
            : {}
    const doc = store[args.id]
    if (!doc) throw new Error(`not found: ${args.collection}/${args.id}`)
    return doc
  })

  const find = vi.fn(async (args: any) => {
    if (args.collection === 'template-definition-versions') {
      const definitionId = args.where?.definition?.equals
      const nums = existingVersionNumbers[definitionId] ?? []
      const max = nums.length > 0 ? Math.max(...nums) : 0
      return { docs: max > 0 ? [{ versionNumber: max }] : [] }
    }
    return { docs: [] }
  })

  const create = vi.fn(async (args: any) => {
    const id = `new-version-${Object.keys(versions).length + 1}`
    const doc = { id, ...args.data }
    versions[id] = doc
    return doc
  })

  const update = vi.fn(async (args: any) => {
    const store = args.collection === 'template-definitions' ? definitions : versions
    store[args.id] = { ...store[args.id], ...args.data }
    return store[args.id]
  })

  return { payload: { findByID, find, create, update } as unknown as Payload, findByID, find, create, update }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('createDraftVersion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates version 1 and denormalizes the parent workspace when none exist yet', async () => {
    const { payload, create, update } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
    })

    const version = await createDraftVersion(payload, {
      definitionId: 'def-1',
      definitionJson: { apiVersion: 'orbit/v2' },
      userId: 'user-1',
      changeNote: 'initial',
    })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definition-versions',
        data: expect.objectContaining({
          definition: 'def-1',
          workspace: 'ws-1',
          versionNumber: 1,
          definitionJson: { apiVersion: 'orbit/v2' },
          editedBy: 'user-1',
          changeNote: 'initial',
        }),
        overrideAccess: true,
      }),
    )
    expect(version.versionNumber).toBe(1)

    // Parent is still draft => currentVersion is updated to point at the new draft.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        id: 'def-1',
        data: expect.objectContaining({ currentVersion: version.id }),
        overrideAccess: true,
      }),
    )
  })

  it('increments versionNumber from the highest existing version', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      existingVersionNumbers: { 'def-1': [1, 2] },
    })

    const version = await createDraftVersion(payload, {
      definitionId: 'def-1',
      definitionJson: {},
      userId: 'user-1',
    })

    expect(version.versionNumber).toBe(3)
  })

  it('does not move currentVersion when the parent is already published', async () => {
    const { payload, update } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'published', currentVersion: 'v-old' } },
    })

    await createDraftVersion(payload, { definitionId: 'def-1', definitionJson: {}, userId: 'user-1' })

    const definitionUpdateCalls = update.mock.calls.filter(
      ([args]) => args.collection === 'template-definitions',
    )
    expect(definitionUpdateCalls).toHaveLength(0)
  })
})

describe('publishVersion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes when validatedAt is set and dryRunRunId points at a succeeded run for this version', async () => {
    const { payload, update } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: {
        'v-1': {
          id: 'v-1',
          definition: 'def-1',
          validatedAt: '2026-01-01T00:00:00.000Z',
          dryRunRunId: 'run-1',
        },
      },
      actionRuns: {
        'run-1': { id: 'run-1', status: 'succeeded', dryRun: true, templateVersion: 'v-1' },
      },
    })

    const result = await publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } })

    expect(result.status).toBe('published')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        id: 'def-1',
        data: expect.objectContaining({ status: 'published', currentVersion: 'v-1' }),
        overrideAccess: true,
      }),
    )
  })

  it('rejects when validatedAt is missing', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: { 'v-1': { id: 'v-1', definition: 'def-1', dryRunRunId: 'run-1' } },
      actionRuns: { 'run-1': { id: 'run-1', status: 'succeeded', dryRun: true, templateVersion: 'v-1' } },
    })

    await expect(
      publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } }),
    ).rejects.toThrow(/valida/i)
  })

  it('rejects when there is no dry run', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: { 'v-1': { id: 'v-1', definition: 'def-1', validatedAt: '2026-01-01T00:00:00.000Z' } },
    })

    await expect(
      publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } }),
    ).rejects.toThrow(/dry.?run/i)
  })

  it('rejects when the dry run did not succeed', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: {
        'v-1': { id: 'v-1', definition: 'def-1', validatedAt: '2026-01-01T00:00:00.000Z', dryRunRunId: 'run-1' },
      },
      actionRuns: { 'run-1': { id: 'run-1', status: 'failed', dryRun: true, templateVersion: 'v-1' } },
    })

    await expect(
      publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } }),
    ).rejects.toThrow(/succeed/i)
  })

  it('rejects when the recorded run has dryRun !== true (a real run cannot satisfy the dry-run gate)', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: {
        'v-1': { id: 'v-1', definition: 'def-1', validatedAt: '2026-01-01T00:00:00.000Z', dryRunRunId: 'run-1' },
      },
      actionRuns: { 'run-1': { id: 'run-1', status: 'succeeded', dryRun: false, templateVersion: 'v-1' } },
    })

    await expect(
      publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } }),
    ).rejects.toThrow(/dry.?run/i)
  })

  it('rejects when the recorded dry run belongs to a different version (gate cannot be satisfied by a stale run)', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: {
        'v-1': { id: 'v-1', definition: 'def-1', validatedAt: '2026-01-01T00:00:00.000Z', dryRunRunId: 'run-1' },
      },
      actionRuns: { 'run-1': { id: 'run-1', status: 'succeeded', dryRun: true, templateVersion: 'v-OTHER' } },
    })

    await expect(
      publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } }),
    ).rejects.toThrow()
  })

  it('rejects when the version does not belong to the given definition', async () => {
    const { payload } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility: 'workspace' } },
      versions: {
        'v-1': {
          id: 'v-1',
          definition: 'def-OTHER',
          validatedAt: '2026-01-01T00:00:00.000Z',
          dryRunRunId: 'run-1',
        },
      },
      actionRuns: { 'run-1': { id: 'run-1', status: 'succeeded', dryRun: true, templateVersion: 'v-1' } },
    })

    await expect(
      publishVersion(payload, { definitionId: 'def-1', versionId: 'v-1', actor: { userId: 'user-1', isPlatformAdmin: false } }),
    ).rejects.toThrow()
  })
})

describe('publishVersion platform-admin gate for shared/public visibility', () => {
  beforeEach(() => vi.clearAllMocks())

  function readyFixtures(visibility: string) {
    return {
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'draft', visibility } },
      versions: {
        'v-1': { id: 'v-1', definition: 'def-1', validatedAt: '2026-01-01T00:00:00.000Z', dryRunRunId: 'run-1' },
      },
      actionRuns: { 'run-1': { id: 'run-1', status: 'succeeded', dryRun: true, templateVersion: 'v-1' } },
    }
  }

  it('rejects a non-platform-admin actor publishing a shared-visibility definition', async () => {
    const { payload } = makePayload(readyFixtures('shared'))
    await expect(
      publishVersion(payload, {
        definitionId: 'def-1',
        versionId: 'v-1',
        actor: { userId: 'user-1', isPlatformAdmin: false },
      }),
    ).rejects.toThrow(/platform admin/i)
  })

  it('rejects a non-platform-admin actor publishing a public-visibility definition', async () => {
    const { payload } = makePayload(readyFixtures('public'))
    await expect(
      publishVersion(payload, {
        definitionId: 'def-1',
        versionId: 'v-1',
        actor: { userId: 'user-1', isPlatformAdmin: false },
      }),
    ).rejects.toThrow(/platform admin/i)
  })

  it('allows a platform-admin actor to publish a shared-visibility definition', async () => {
    const { payload } = makePayload(readyFixtures('shared'))
    const result = await publishVersion(payload, {
      definitionId: 'def-1',
      versionId: 'v-1',
      actor: { userId: 'admin-1', isPlatformAdmin: true },
    })
    expect(result.status).toBe('published')
  })

  it('allows a platform-admin actor to publish a public-visibility definition', async () => {
    const { payload } = makePayload(readyFixtures('public'))
    const result = await publishVersion(payload, {
      definitionId: 'def-1',
      versionId: 'v-1',
      actor: { userId: 'admin-1', isPlatformAdmin: true },
    })
    expect(result.status).toBe('published')
  })

  it('allows a non-platform-admin actor to publish a workspace-visibility definition (unaffected)', async () => {
    const { payload } = makePayload(readyFixtures('workspace'))
    const result = await publishVersion(payload, {
      definitionId: 'def-1',
      versionId: 'v-1',
      actor: { userId: 'user-1', isPlatformAdmin: false },
    })
    expect(result.status).toBe('published')
  })
})

describe('deprecateDefinition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets status to deprecated', async () => {
    const { payload, update } = makePayload({
      definitions: { 'def-1': { id: 'def-1', workspace: 'ws-1', status: 'published' } },
    })

    const result = await deprecateDefinition(payload, { definitionId: 'def-1', userId: 'user-1' })

    expect(result.status).toBe('deprecated')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'template-definitions',
        id: 'def-1',
        data: expect.objectContaining({ status: 'deprecated' }),
        overrideAccess: true,
      }),
    )
  })
})
