/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { ActionRuns } from '../ActionRuns'

describe('ActionRuns Scaffolder extension (Phase 1)', () => {
  it('adds templateVersion, dryRun, steps, plan, artifactsPrefix fields', () => {
    const fieldNames = ActionRuns.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(fieldNames).toEqual(
      expect.arrayContaining(['templateVersion', 'dryRun', 'steps', 'plan', 'artifactsPrefix']),
    )
  })

  it('templateVersion relates to template-definition-versions and is indexed', () => {
    const field = ActionRuns.fields.find(
      (f) => 'name' in f && f.name === 'templateVersion',
    ) as { relationTo?: string; index?: boolean } | undefined
    expect(field?.relationTo).toBe('template-definition-versions')
    expect(field?.index).toBe(true)
  })

  it('dryRun defaults to false', () => {
    const field = ActionRuns.fields.find((f) => 'name' in f && f.name === 'dryRun') as
      | { type?: string; defaultValue?: unknown }
      | undefined
    expect(field?.type).toBe('checkbox')
    expect(field?.defaultValue).toBe(false)
  })

  it('steps is an array of per-step status entries', () => {
    const field = ActionRuns.fields.find((f) => 'name' in f && f.name === 'steps') as
      | { type?: string; fields?: Array<{ name?: string }> }
      | undefined
    expect(field?.type).toBe('array')
    const subFieldNames = (field?.fields ?? []).map((f) => f.name)
    expect(subFieldNames).toEqual(
      expect.arrayContaining(['id', 'name', 'status', 'startedAt', 'finishedAt', 'logTail', 'output']),
    )
  })

  it('status select now includes cancelled', () => {
    const field = ActionRuns.fields.find((f) => 'name' in f && f.name === 'status') as
      | { options?: Array<{ value: string }> }
      | undefined
    const values = (field?.options ?? []).map((o) => o.value)
    expect(values).toContain('cancelled')
    // pre-existing statuses must still be present
    expect(values).toEqual(
      expect.arrayContaining(['pending', 'awaiting-approval', 'running', 'succeeded', 'failed', 'cancelled']),
    )
  })
})
