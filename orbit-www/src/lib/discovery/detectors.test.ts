import { describe, it, expect } from 'vitest'
import {
  detectOrbitManifest,
  detectApiSpecs,
  detectService,
  detectOwnershipHints,
  runDetectors,
  extractSpecMetadata,
  DISCOVERY_FETCH_PATTERNS,
  type EvidenceBundle,
} from './detectors'

function bundle(files: Record<string, string>, extraTree: string[] = []): EvidenceBundle {
  return {
    tree: [...Object.keys(files), ...extraTree],
    files,
  }
}

const ORBIT_YAML = `apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: billing-service
  description: Handles invoices
build:
  language: go
  framework: fiber
`

const OPENAPI_YAML = `openapi: 3.0.0
info:
  title: Payments API
  description: Money movement
  version: 1.2.0
  contact:
    name: Platform Team
    email: platform@example.com
servers:
  - url: https://api.example.com
paths:
  /pay:
    get: {}
    post: {}
  /refund:
    post: {}
`

const ASYNCAPI_YAML = `asyncapi: 2.6.0
info:
  title: Orders Events
  version: 0.1.0
channels:
  order/created: {}
  order/shipped: {}
`

describe('extractSpecMetadata', () => {
  it('sniffs an OpenAPI spec', () => {
    const meta = extractSpecMetadata(OPENAPI_YAML)
    expect(meta).not.toBeNull()
    expect(meta!.schemaType).toBe('openapi')
    expect(meta!.title).toBe('Payments API')
    expect(meta!.description).toBe('Money movement')
    expect(meta!.version).toBe('1.2.0')
    expect(meta!.contactName).toBe('Platform Team')
    expect(meta!.contactEmail).toBe('platform@example.com')
    expect(meta!.serverUrls).toEqual(['https://api.example.com'])
    // 2 methods on /pay + 1 on /refund
    expect(meta!.endpointCount).toBe(3)
  })

  it('sniffs a Swagger 2.0 spec as openapi', () => {
    const meta = extractSpecMetadata('swagger: "2.0"\ninfo:\n  title: Legacy\n  version: "1"\n')
    expect(meta!.schemaType).toBe('openapi')
    expect(meta!.title).toBe('Legacy')
  })

  it('sniffs an AsyncAPI spec and counts channels', () => {
    const meta = extractSpecMetadata(ASYNCAPI_YAML)
    expect(meta!.schemaType).toBe('asyncapi')
    expect(meta!.title).toBe('Orders Events')
    expect(meta!.endpointCount).toBe(2)
  })

  it('returns null schemaType for unrecognized YAML', () => {
    const meta = extractSpecMetadata('foo: bar\n')
    expect(meta).not.toBeNull()
    expect(meta!.schemaType).toBeNull()
  })

  it('returns null for invalid YAML', () => {
    expect(extractSpecMetadata('{{not yaml')).toBeNull()
  })

  it('leaves serverUrls null when spec has no servers array', () => {
    const meta = extractSpecMetadata('openapi: 3.0.0\ninfo:\n  title: X\n  version: "1"\n')
    expect(meta!.serverUrls).toBeNull()
  })
})

describe('detectOrbitManifest', () => {
  it('produces a high-confidence service detection from a valid .orbit.yaml', () => {
    const detections = detectOrbitManifest(bundle({ '.orbit.yaml': ORBIT_YAML }))
    expect(detections).toHaveLength(1)
    const d = detections[0]
    expect(d.kind).toBe('service')
    expect(d.confidence).toBe('high')
    expect(d.name).toBe('billing-service')
    expect(d.path).toBe('')
    expect(d.proposal.name).toBe('billing-service')
    expect(d.proposal.description).toBe('Handles invoices')
    expect((d.proposal.buildConfig as Record<string, unknown>).language).toBe('go')
    expect(d.evidence[0].detector).toBe('orbit-manifest')
    expect(d.evidence[0].file).toBe('.orbit.yaml')
  })

  it('accepts a .orbit.yml variant', () => {
    const detections = detectOrbitManifest(bundle({ '.orbit.yml': ORBIT_YAML }))
    expect(detections).toHaveLength(1)
    expect(detections[0].evidence[0].file).toBe('.orbit.yml')
  })

  it('produces no detection for an invalid manifest', () => {
    const detections = detectOrbitManifest(bundle({ '.orbit.yaml': 'apiVersion: wrong\nkind: Nope\n' }))
    expect(detections).toHaveLength(0)
  })

  it('ignores an .orbit.yaml that is not at repo root', () => {
    const detections = detectOrbitManifest(bundle({ 'sub/.orbit.yaml': ORBIT_YAML }))
    expect(detections).toHaveLength(0)
  })
})

describe('detectApiSpecs', () => {
  it('produces a high-confidence api detection for a parseable OpenAPI file', () => {
    const detections = detectApiSpecs(bundle({ 'openapi.yaml': OPENAPI_YAML }))
    expect(detections).toHaveLength(1)
    const d = detections[0]
    expect(d.kind).toBe('api')
    expect(d.confidence).toBe('high')
    expect(d.name).toBe('Payments API')
    expect(d.proposal.schemaType).toBe('openapi')
    expect(d.proposal.specPath).toBe('openapi.yaml')
    expect(d.proposal.specTitle).toBe('Payments API')
    expect(d.proposal.rawContent).toBe(OPENAPI_YAML)
    expect(d.path).toBe('')
  })

  it('detects nested spec paths and reports their scope', () => {
    const detections = detectApiSpecs(bundle({ 'docs/api/openapi.yaml': OPENAPI_YAML }))
    expect(detections).toHaveLength(1)
    expect(detections[0].path).toBe('docs/api')
    expect(detections[0].proposal.specPath).toBe('docs/api/openapi.yaml')
  })

  it('produces a medium-confidence detection for a filename-only match (no content)', () => {
    const detections = detectApiSpecs(bundle({}, ['api/swagger.json']))
    expect(detections).toHaveLength(1)
    expect(detections[0].confidence).toBe('medium')
    expect(detections[0].proposal.schemaType).toBe('openapi')
    expect(detections[0].name).toBe('swagger')
  })

  it('detects AsyncAPI specs', () => {
    const detections = detectApiSpecs(bundle({ 'asyncapi.yaml': ASYNCAPI_YAML }))
    expect(detections).toHaveLength(1)
    expect(detections[0].proposal.schemaType).toBe('asyncapi')
  })

  it('detects a GraphQL SDL file by content', () => {
    const sdl = 'type Query {\n  hello: String\n}\n'
    const detections = detectApiSpecs(bundle({ 'schema.graphql': sdl }))
    expect(detections).toHaveLength(1)
    expect(detections[0].proposal.schemaType).toBe('graphql')
    expect(detections[0].confidence).toBe('high')
  })

  it('does not double-count a file present in both tree and files', () => {
    const b: EvidenceBundle = {
      tree: ['openapi.yaml'],
      files: { 'openapi.yaml': OPENAPI_YAML },
    }
    expect(detectApiSpecs(b)).toHaveLength(1)
  })

  it('ignores a spec-named file whose content does not parse as a spec', () => {
    const detections = detectApiSpecs(bundle({ 'openapi.yaml': 'just: some\nrandom: yaml\n' }))
    // filename matches, content present but not a real spec -> still an api,
    // but downgraded to medium since content did not confirm
    expect(detections).toHaveLength(1)
    expect(detections[0].confidence).toBe('medium')
  })
})

describe('detectService', () => {
  it('high confidence with Dockerfile + build manifest', () => {
    const detections = detectService(
      bundle({ Dockerfile: 'FROM golang:1.22', 'go.mod': 'module github.com/acme/widget\n' }),
    )
    expect(detections).toHaveLength(1)
    const d = detections[0]
    expect(d.kind).toBe('service')
    expect(d.confidence).toBe('high')
    expect(d.name).toBe('widget')
    expect((d.proposal.buildConfig as Record<string, unknown>).language).toBe('go')
  })

  it('medium confidence with only a build manifest', () => {
    const detections = detectService(bundle({ 'go.mod': 'module github.com/acme/widget\n' }))
    expect(detections).toHaveLength(1)
    expect(detections[0].confidence).toBe('medium')
  })

  it('medium confidence with only a Dockerfile', () => {
    const detections = detectService(bundle({ Dockerfile: 'FROM alpine' }))
    expect(detections).toHaveLength(1)
    expect(detections[0].confidence).toBe('medium')
  })

  it('detects nodejs language and framework from package.json', () => {
    const pkg = JSON.stringify({ name: 'web-app', dependencies: { next: '15.0.0' } })
    const detections = detectService(bundle({ 'package.json': pkg, Dockerfile: 'FROM node:22' }))
    const bc = detections[0].proposal.buildConfig as Record<string, unknown>
    expect(bc.language).toBe('nodejs')
    expect(bc.framework).toBe('nextjs')
    expect(detections[0].name).toBe('web-app')
  })

  it('detects python from pyproject and fastapi framework', () => {
    const py = '[project]\nname = "svc"\ndependencies = ["fastapi"]\n'
    const detections = detectService(bundle({ 'pyproject.toml': py }))
    const bc = detections[0].proposal.buildConfig as Record<string, unknown>
    expect(bc.language).toBe('python')
    expect(bc.framework).toBe('fastapi')
  })

  it('produces one detection per path scope in a monorepo', () => {
    const detections = detectService(
      bundle({
        'services/a/go.mod': 'module a\n',
        'services/a/Dockerfile': 'FROM golang',
        'services/b/package.json': '{"name":"b"}',
      }),
    )
    const paths = detections.map((d) => d.path).sort()
    expect(paths).toEqual(['services/a', 'services/b'])
    const a = detections.find((d) => d.path === 'services/a')!
    expect(a.confidence).toBe('high')
  })

  it('treats docker-compose as a container signal for high confidence', () => {
    const detections = detectService(
      bundle({ 'docker-compose.yml': 'services: {}', 'go.mod': 'module x\n' }),
    )
    expect(detections[0].confidence).toBe('high')
  })
})

describe('detectOwnershipHints', () => {
  it('parses owners from a root CODEOWNERS file', () => {
    const codeowners = '# comment\n* @acme/platform\n/docs @jane @john\n'
    const hints = detectOwnershipHints(bundle({ CODEOWNERS: codeowners }))
    expect(hints.length).toBeGreaterThan(0)
    expect(hints[0].detector).toBe('codeowners')
    expect(hints[0].excerpt).toContain('@acme/platform')
    expect(hints[0].excerpt).toContain('@jane')
  })

  it('reads CODEOWNERS from .github and docs locations', () => {
    expect(detectOwnershipHints(bundle({ '.github/CODEOWNERS': '* @team\n' }))).toHaveLength(1)
    expect(detectOwnershipHints(bundle({ 'docs/CODEOWNERS': '* @team\n' }))).toHaveLength(1)
  })

  it('returns nothing when there is no CODEOWNERS', () => {
    expect(detectOwnershipHints(bundle({ 'go.mod': 'module x' }))).toHaveLength(0)
  })
})

describe('runDetectors', () => {
  it('yields one service + N api detections for a mixed repo', () => {
    const detections = runDetectors(
      bundle({
        Dockerfile: 'FROM node:22',
        'package.json': '{"name":"gateway","dependencies":{"express":"4"}}',
        'openapi.yaml': OPENAPI_YAML,
        'asyncapi.yaml': ASYNCAPI_YAML,
      }),
    )
    const services = detections.filter((d) => d.kind === 'service')
    const apis = detections.filter((d) => d.kind === 'api')
    expect(services).toHaveLength(1)
    expect(apis).toHaveLength(2)
  })

  it('suppresses the heuristic service when an .orbit.yaml covers the same path', () => {
    const detections = runDetectors(
      bundle({
        '.orbit.yaml': ORBIT_YAML,
        Dockerfile: 'FROM golang',
        'go.mod': 'module github.com/acme/widget\n',
      }),
    )
    const services = detections.filter((d) => d.kind === 'service')
    expect(services).toHaveLength(1)
    expect(services[0].evidence.some((e) => e.detector === 'orbit-manifest')).toBe(true)
    expect(services[0].name).toBe('billing-service')
  })

  it('attaches ownership hints to service detections', () => {
    const detections = runDetectors(
      bundle({ 'go.mod': 'module github.com/acme/widget\n', CODEOWNERS: '* @acme/platform\n' }),
    )
    const service = detections.find((d) => d.kind === 'service')!
    expect(service.evidence.some((e) => e.detector === 'codeowners')).toBe(true)
  })

  it('keeps a heuristic service at a different path from the orbit root manifest', () => {
    const detections = runDetectors(
      bundle({
        '.orbit.yaml': ORBIT_YAML,
        'services/other/go.mod': 'module github.com/acme/other\n',
      }),
    )
    const services = detections.filter((d) => d.kind === 'service')
    expect(services.map((s) => s.path).sort()).toEqual(['', 'services/other'])
  })
})

describe('DISCOVERY_FETCH_PATTERNS', () => {
  it('includes the core well-known paths', () => {
    expect(DISCOVERY_FETCH_PATTERNS).toContain('.orbit.yaml')
    expect(DISCOVERY_FETCH_PATTERNS).toContain('openapi.yaml')
    expect(DISCOVERY_FETCH_PATTERNS).toContain('Dockerfile')
    expect(DISCOVERY_FETCH_PATTERNS).toContain('package.json')
    expect(DISCOVERY_FETCH_PATTERNS).toContain('go.mod')
    expect(DISCOVERY_FETCH_PATTERNS).toContain('CODEOWNERS')
  })
})
