import { describe, it, expect } from 'vitest'
import {
  parseAppManifest,
  serializeAppManifest,
  mapManifestToAppFields,
  mapAppFieldsToManifest,
  type AppManifest,
} from './app-manifest'

describe('parseAppManifest', () => {
  it('parses valid manifest YAML', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: my-service
  description: A test service
health:
  endpoint: /health
  interval: 60
  timeout: 5
  method: GET
  expectedStatus: 200
build:
  language: typescript
  languageVersion: "20"
  framework: nextjs
  buildCommand: npm run build
  startCommand: npm start
  dockerfilePath: Dockerfile
`
    const { manifest, errors } = parseAppManifest(yaml)
    expect(errors).toHaveLength(0)
    expect(manifest).not.toBeNull()
    expect(manifest!.metadata.name).toBe('my-service')
    expect(manifest!.health?.endpoint).toBe('/health')
    expect(manifest!.build?.language).toBe('typescript')
  })

  it('returns errors for invalid YAML syntax', () => {
    const { manifest, errors } = parseAppManifest('{{invalid yaml')
    expect(manifest).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toContain('Invalid YAML')
  })

  it('returns errors for wrong apiVersion', () => {
    const yaml = `
apiVersion: wrong/v1
kind: Application
metadata:
  name: test
`
    const { errors } = parseAppManifest(yaml)
    expect(errors.some(e => e.message.includes('apiVersion'))).toBe(true)
  })

  it('returns errors for wrong kind', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Template
metadata:
  name: test
`
    const { errors } = parseAppManifest(yaml)
    expect(errors.some(e => e.message.includes('kind'))).toBe(true)
  })

  it('returns errors for missing metadata.name', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Application
metadata:
  description: no name
`
    const { errors } = parseAppManifest(yaml)
    expect(errors.some(e => e.path === 'metadata.name')).toBe(true)
  })

  it('parses manifest with only required fields', () => {
    const yaml = `
apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: minimal
`
    const { manifest, errors } = parseAppManifest(yaml)
    expect(errors).toHaveLength(0)
    expect(manifest).not.toBeNull()
    expect(manifest!.metadata.name).toBe('minimal')
    expect(manifest!.health).toBeUndefined()
    expect(manifest!.build).toBeUndefined()
  })
})

describe('serializeAppManifest', () => {
  it('serializes app fields to valid YAML', () => {
    const fields = {
      name: 'my-service',
      description: 'A test service',
      healthConfig: {
        url: '/health',
        interval: 60,
        timeout: 5,
        method: 'GET' as const,
        expectedStatus: 200,
      },
      buildConfig: {
        language: 'typescript',
        languageVersion: '20',
        framework: 'nextjs',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        dockerfilePath: 'Dockerfile',
      },
    }
    const yaml = serializeAppManifest(fields)
    expect(yaml).toContain('apiVersion: orbit.dev/v1')
    expect(yaml).toContain('kind: Application')
    expect(yaml).toContain('name: my-service')
    // Round-trip: parse what we serialized
    const { manifest, errors } = parseAppManifest(yaml)
    expect(errors).toHaveLength(0)
    expect(manifest!.metadata.name).toBe('my-service')
  })

  it('omits empty optional sections', () => {
    const fields = { name: 'minimal' }
    const yaml = serializeAppManifest(fields)
    expect(yaml).toContain('name: minimal')
    expect(yaml).not.toContain('health:')
    expect(yaml).not.toContain('build:')
  })
})

describe('mapManifestToAppFields', () => {
  it('maps manifest to Payload update data', () => {
    const manifest: AppManifest = {
      apiVersion: 'orbit.dev/v1',
      kind: 'Application',
      metadata: { name: 'test', description: 'desc' },
      health: { endpoint: '/health', interval: 30, timeout: 10, method: 'POST' as const, expectedStatus: 201 },
      build: { language: 'go', languageVersion: '1.21', framework: 'fiber', buildCommand: 'go build', startCommand: './app', dockerfilePath: 'Dockerfile.prod' },
    }
    const fields = mapManifestToAppFields(manifest)
    expect(fields.name).toBe('test')
    expect(fields.description).toBe('desc')
    expect(fields.healthConfig?.url).toBe('/health')
    expect(fields.healthConfig?.interval).toBe(30)
    expect(fields.buildConfig?.language).toBe('go')
    expect(fields.buildConfig?.buildCommand).toBe('go build')
  })
})

describe('mapAppFieldsToManifest', () => {
  it('maps Payload app fields to manifest structure', () => {
    const fields = {
      name: 'test',
      description: 'desc',
      healthConfig: { url: '/health', interval: 30, timeout: 10, method: 'POST' as const, expectedStatus: 201 },
      buildConfig: { language: 'go', languageVersion: '1.21', framework: 'fiber', buildCommand: 'go build', startCommand: './app', dockerfilePath: 'Dockerfile.prod' },
    }
    const manifest = mapAppFieldsToManifest(fields)
    expect(manifest.apiVersion).toBe('orbit.dev/v1')
    expect(manifest.kind).toBe('Application')
    expect(manifest.metadata.name).toBe('test')
    expect(manifest.health?.endpoint).toBe('/health')
    expect(manifest.build?.language).toBe('go')
  })
})
