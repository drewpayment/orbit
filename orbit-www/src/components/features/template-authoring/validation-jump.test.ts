import { describe, expect, it } from 'vitest'
import { parseJumpTarget } from './validation-jump'

describe('parseJumpTarget', () => {
  it('routes a metadata error to the metadata panel', () => {
    expect(parseJumpTarget('metadata.name')).toEqual({ tab: 'metadata', label: 'Metadata' })
  })

  it('routes a parameter-page error to the parameters tab with its page index', () => {
    expect(parseJumpTarget('spec.parameters.0.properties.repoName')).toEqual({
      tab: 'parameters',
      pageIndex: 0,
      label: 'Parameters, page 1',
    })
  })

  it('accepts bracket index notation as well as dotted', () => {
    expect(parseJumpTarget('spec.parameters[2].title')).toMatchObject({
      tab: 'parameters',
      pageIndex: 2,
    })
  })

  it('routes a step error to the steps tab with its step index', () => {
    expect(parseJumpTarget('spec.steps.1.input.owner')).toEqual({
      tab: 'steps',
      stepIndex: 1,
      label: 'Steps, step 2',
    })
  })

  it('routes an output error to the output tab', () => {
    expect(parseJumpTarget('spec.output.links.0.url')).toMatchObject({ tab: 'output' })
  })

  it('routes a bare spec.parameters error to the parameters tab without an index', () => {
    expect(parseJumpTarget('spec.parameters')).toEqual({ tab: 'parameters', label: 'Parameters' })
  })

  it('returns null for a path it cannot place, so the caller renders a flat list', () => {
    expect(parseJumpTarget('')).toBeNull()
    expect(parseJumpTarget('apiVersion')).toBeNull()
    expect(parseJumpTarget('something.else.entirely')).toBeNull()
  })

  it('does not treat a non-numeric segment as an index', () => {
    expect(parseJumpTarget('spec.steps.oops.input')).toEqual({ tab: 'steps', label: 'Steps' })
  })
})
