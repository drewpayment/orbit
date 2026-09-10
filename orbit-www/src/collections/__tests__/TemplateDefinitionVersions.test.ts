/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload } from 'payload'
import { TemplateDefinitionVersions } from '../TemplateDefinitionVersions'

/* eslint-disable @typescript-eslint/no-explicit-any */
function makePayload(memberWorkspaceIds: string[]) {
  const find = vi.fn(async (args: any) => {
    if (args.collection !== 'workspace-members') return { docs: [] }
    return { docs: memberWorkspaceIds.map((workspace) => ({ workspace, role: 'member', status: 'active' })) }
  })
  return { payload: { find } as unknown as Payload, find }
}

const invoke = (access: Access, ctx: { user?: unknown; payload?: Payload }) =>
  access({ req: { user: ctx.user, payload: ctx.payload } } as any)

const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('TemplateDefinitionVersions collection shape', () => {
  it('is slugged template-definition-versions with the expected fields', () => {
    expect(TemplateDefinitionVersions.slug).toBe('template-definition-versions')
    const fieldNames = TemplateDefinitionVersions.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'definition',
        'workspace',
        'versionNumber',
        'definitionJson',
        'editedBy',
        'changeNote',
        'validatedAt',
        'dryRunRunId',
      ]),
    )
  })

  it('has a unique (definition, versionNumber) index', () => {
    expect(TemplateDefinitionVersions.indexes ?? []).toContainEqual({
      fields: ['definition', 'versionNumber'],
      unique: true,
    })
  })
})

describe('TemplateDefinitionVersions.access', () => {
  it('read is workspace-scoped', async () => {
    const { payload } = makePayload(['ws-1'])
    const result = await invoke(TemplateDefinitionVersions.access!.read!, { user: plainUser, payload })
    expect(result).toEqual({ workspace: { in: ['ws-1'] } })
  })

  it('denies anonymous reads', async () => {
    const { payload } = makePayload([])
    const result = await invoke(TemplateDefinitionVersions.access!.read!, { user: undefined, payload })
    expect(result).toBe(false)
  })

  it('is write-closed to humans (create/update/delete always false)', () => {
    expect(TemplateDefinitionVersions.access!.create!({} as any)).toBe(false)
    expect(TemplateDefinitionVersions.access!.update!({} as any)).toBe(false)
    expect(TemplateDefinitionVersions.access!.delete!({} as any)).toBe(false)
  })
})
