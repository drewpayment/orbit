import { describe, expect, it } from 'vitest'
import { applyParameterDefaults, type DefaultableParameterPage } from './defaults'

function page(properties: DefaultableParameterPage['properties']): DefaultableParameterPage {
  return { properties }
}

describe('applyParameterDefaults', () => {
  it('fills a missing string default', () => {
    const got = applyParameterDefaults(
      [page({ repoName: { type: 'string', default: 'my-repo' } })],
      {},
    )
    expect(got).toEqual({ repoName: 'my-repo' })
  })

  it('fills a missing boolean default', () => {
    const got = applyParameterDefaults([page({ private: { type: 'boolean', default: true } })], {})
    expect(got).toEqual({ private: true })
  })

  it('never overrides a provided value, including an explicit false', () => {
    const got = applyParameterDefaults(
      [page({ private: { type: 'boolean', default: true } })],
      { private: false },
    )
    expect(got).toEqual({ private: false })
  })

  it('never overrides an explicit empty string or zero', () => {
    const got = applyParameterDefaults(
      [
        page({
          repoName: { type: 'string', default: 'my-repo' },
          replicas: { type: 'integer', default: 3 },
        }),
      ],
      { repoName: '', replicas: 0 },
    )
    expect(got).toEqual({ repoName: '', replicas: 0 })
  })

  it('leaves a property with no declared default absent', () => {
    const got = applyParameterDefaults([page({ repoName: { type: 'string' } })], {})
    expect(got).toEqual({})
  })

  it('merges defaults across multiple pages', () => {
    const got = applyParameterDefaults(
      [
        page({ a: { type: 'string', default: 'a-default' } }),
        page({ b: { type: 'string', default: 'b-default' } }),
      ],
      { a: 'explicit-a' },
    )
    expect(got).toEqual({ a: 'explicit-a', b: 'b-default' })
  })

  it('fills defaults inside a nested object property', () => {
    const got = applyParameterDefaults(
      [page({ address: { type: 'object', properties: { city: { type: 'string', default: 'Anytown' } } } })],
      {},
    )
    expect(got).toEqual({ address: { city: 'Anytown' } })
  })

  it('does not override an explicit key inside a nested object', () => {
    const got = applyParameterDefaults(
      [page({ address: { type: 'object', properties: { city: { type: 'string', default: 'Anytown' } } } })],
      { address: { city: 'Realtown' } },
    )
    expect(got).toEqual({ address: { city: 'Realtown' } })
  })

  it('does not mutate the input params map', () => {
    const params: Record<string, unknown> = {}
    applyParameterDefaults([page({ repoName: { type: 'string', default: 'my-repo' } })], params)
    expect(params).toEqual({})
  })

  it('does not mutate a nested object inside the input params map', () => {
    const params: Record<string, unknown> = { address: { unrelated: 1 } }
    const got = applyParameterDefaults(
      [page({ address: { type: 'object', properties: { city: { type: 'string', default: 'Anytown' } } } })],
      params,
    )

    expect(got.address).toEqual({ unrelated: 1, city: 'Anytown' })
    expect(params.address).toEqual({ unrelated: 1 })
  })

  it('leaves a free-form key-value object alone (no declared properties)', () => {
    const got = applyParameterDefaults(
      [page({ labels: { type: 'object' } })],
      {},
    )
    expect(got).toEqual({})
  })
})
