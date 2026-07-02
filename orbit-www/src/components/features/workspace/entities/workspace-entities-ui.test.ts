import { describe, expect, it } from 'vitest'
import {
  catalogEntityHref,
  catalogNewEntityHref,
  catalogNewTeamHref,
  catalogViewAllHref,
  groupEntitiesByKind,
  hasTeamEntity,
  totalEntityCount,
  type WorkspaceEntitySummary,
} from './workspace-entities-ui'

const entity = (id: string, name: string, kind: WorkspaceEntitySummary['kind']): WorkspaceEntitySummary => ({
  id,
  name,
  kind,
})

describe('groupEntitiesByKind', () => {
  it('groups by kind, sorts entities alphabetically within a group, and caps the preview', () => {
    const entities = [
      entity('1', 'Zeta Service', 'service'),
      entity('2', 'Alpha Service', 'service'),
      entity('3', 'Mid Service', 'service'),
      entity('4', 'Payments API', 'api'),
    ]

    const groups = groupEntitiesByKind(entities, 2)

    const services = groups.find((g) => g.kind === 'service')
    expect(services?.count).toBe(3)
    expect(services?.topEntities.map((e) => e.name)).toEqual(['Alpha Service', 'Mid Service'])

    const apis = groups.find((g) => g.kind === 'api')
    expect(apis?.count).toBe(1)
    expect(apis?.label).toBe('APIs')
  })

  it('orders groups by count descending, then label ascending', () => {
    const entities = [
      entity('1', 'A', 'domain'),
      entity('2', 'B', 'service'),
      entity('3', 'C', 'service'),
      entity('4', 'D', 'api'),
      entity('5', 'E', 'api'),
    ]

    const groups = groupEntitiesByKind(entities)
    // service and api both have count 2, domain has count 1 -> service/api tie broken alphabetically by label
    expect(groups.map((g) => g.kind)).toEqual(['api', 'service', 'domain'])
  })

  it('returns an empty array for no entities', () => {
    expect(groupEntitiesByKind([])).toEqual([])
  })

  it('defaults the preview cap to 5', () => {
    const entities = Array.from({ length: 8 }, (_, i) => entity(String(i), `Service ${i}`, 'service'))
    const [group] = groupEntitiesByKind(entities)
    expect(group.count).toBe(8)
    expect(group.topEntities).toHaveLength(5)
  })
})

describe('totalEntityCount', () => {
  it('sums counts across groups', () => {
    const groups = groupEntitiesByKind([
      entity('1', 'A', 'service'),
      entity('2', 'B', 'service'),
      entity('3', 'C', 'api'),
    ])
    expect(totalEntityCount(groups)).toBe(3)
  })

  it('is zero for no groups', () => {
    expect(totalEntityCount([])).toBe(0)
  })
})

describe('hasTeamEntity', () => {
  it('is true when a team-kind entity is present', () => {
    expect(hasTeamEntity([entity('1', 'Platform Team', 'team')])).toBe(true)
  })

  it('is false when no team-kind entity is present', () => {
    expect(hasTeamEntity([entity('1', 'A', 'service'), entity('2', 'B', 'api')])).toBe(false)
  })

  it('is false for an empty list', () => {
    expect(hasTeamEntity([])).toBe(false)
  })
})

describe('link helpers', () => {
  it('builds the entity detail link', () => {
    expect(catalogEntityHref('abc123')).toBe('/catalog/abc123')
  })

  it('builds the new-entity link with the workspace preselected', () => {
    expect(catalogNewEntityHref('ws1')).toBe('/catalog/new?workspace=ws1')
  })

  it('URL-encodes the workspace id in link helpers', () => {
    expect(catalogNewEntityHref('ws 1')).toBe('/catalog/new?workspace=ws%201')
  })

  it('builds the create-team link preset to kind=team', () => {
    expect(catalogNewTeamHref('ws1')).toBe('/catalog/new?workspace=ws1&kind=team')
  })

  it('builds the view-all-in-catalog link, filtered to the workspace', () => {
    expect(catalogViewAllHref('ws1')).toBe('/catalog?workspace=ws1')
  })

  it('URL-encodes the workspace id in the view-all-in-catalog link', () => {
    expect(catalogViewAllHref('ws 1')).toBe('/catalog?workspace=ws%201')
  })
})
