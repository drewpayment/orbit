// orbit-www/src/lib/template-manifest.test.ts
import { describe, it, expect } from 'vitest'
import { parseManifest } from './template-manifest'

describe('parseManifest', () => {
  const validManifest = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: My Template
  language: typescript
  framework: nextjs
  categories:
    - frontend-app
  tags:
    - react
    - nextjs
  complexity: starter
variables:
  - key: PROJECT_NAME
    type: string
    required: true
    description: The name of your project
`

  describe('valid manifests', () => {
    it('should parse a valid manifest', () => {
      const { manifest, errors } = parseManifest(validManifest)
      expect(errors).toHaveLength(0)
      expect(manifest).not.toBeNull()
      expect(manifest?.metadata.name).toBe('My Template')
      expect(manifest?.metadata.language).toBe('typescript')
      expect(manifest?.metadata.framework).toBe('nextjs')
      expect(manifest?.metadata.categories).toEqual(['frontend-app'])
      expect(manifest?.metadata.tags).toEqual(['react', 'nextjs'])
      expect(manifest?.metadata.complexity).toBe('starter')
    })

    it('should parse a minimal valid manifest', () => {
      const minimal = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Minimal
  language: go
  categories:
    - backend-service
`
      const { manifest, errors } = parseManifest(minimal)
      expect(errors).toHaveLength(0)
      expect(manifest).not.toBeNull()
      expect(manifest?.metadata.name).toBe('Minimal')
      expect(manifest?.metadata.language).toBe('go')
    })

    it('should parse variables with all types', () => {
      const withVariables = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: With Variables
  language: typescript
  categories:
    - api-service
variables:
  - key: NAME
    type: string
    required: true
  - key: PORT
    type: number
    required: false
    default: 3000
  - key: DEBUG
    type: boolean
    required: false
    default: false
  - key: REGION
    type: select
    required: true
    options:
      - label: US East
        value: us-east-1
      - label: EU West
        value: eu-west-1
  - key: FEATURES
    type: multiselect
    required: false
    options:
      - label: Auth
        value: auth
      - label: API
        value: api
`
      const { manifest, errors } = parseManifest(withVariables)
      expect(errors).toHaveLength(0)
      expect(manifest?.variables).toHaveLength(5)
      expect(manifest?.variables?.[0].type).toBe('string')
      expect(manifest?.variables?.[1].type).toBe('number')
      expect(manifest?.variables?.[1].default).toBe(3000)
      expect(manifest?.variables?.[2].type).toBe('boolean')
      expect(manifest?.variables?.[3].type).toBe('select')
      expect(manifest?.variables?.[3].options).toHaveLength(2)
      expect(manifest?.variables?.[4].type).toBe('multiselect')
    })

    it('should parse hooks', () => {
      const withHooks = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: With Hooks
  language: typescript
  categories:
    - cli-tool
hooks:
  postGeneration:
    - command: npm install
      description: Install dependencies
    - command: npm run setup
      workingDir: scripts
`
      const { manifest, errors } = parseManifest(withHooks)
      expect(errors).toHaveLength(0)
      expect(manifest?.hooks?.postGeneration).toHaveLength(2)
      expect(manifest?.hooks?.postGeneration?.[0].command).toBe('npm install')
      expect(manifest?.hooks?.postGeneration?.[1].workingDir).toBe('scripts')
    })
  })

  describe('invalid YAML', () => {
    it('should return error for invalid YAML syntax', () => {
      const invalid = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  invalid yaml: [unclosed
`
      const { manifest, errors } = parseManifest(invalid)
      expect(manifest).toBeNull()
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Invalid YAML')
    })

    it('should return error for non-object content', () => {
      const { manifest, errors } = parseManifest('just a string')
      expect(manifest).toBeNull()
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('Manifest must be an object')
    })
  })

  describe('missing required fields', () => {
    it('should return error for wrong apiVersion', () => {
      const wrongVersion = `
apiVersion: v2
kind: Template
metadata:
  name: Test
  language: go
  categories:
    - api-service
`
      const { manifest, errors } = parseManifest(wrongVersion)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path === 'apiVersion')).toBe(true)
    })

    it('should return error for wrong kind', () => {
      const wrongKind = `
apiVersion: orbit/v1
kind: Service
metadata:
  name: Test
  language: go
  categories:
    - api-service
`
      const { manifest, errors } = parseManifest(wrongKind)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path === 'kind')).toBe(true)
    })

    it('should return error for missing metadata', () => {
      const noMetadata = `
apiVersion: orbit/v1
kind: Template
`
      const { manifest, errors } = parseManifest(noMetadata)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path === 'metadata')).toBe(true)
    })

    it('should return error for missing name', () => {
      const noName = `
apiVersion: orbit/v1
kind: Template
metadata:
  language: go
  categories:
    - api-service
`
      const { manifest, errors } = parseManifest(noName)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path === 'metadata.name')).toBe(true)
    })

    it('should return error for missing language', () => {
      const noLanguage = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  categories:
    - api-service
`
      const { manifest, errors } = parseManifest(noLanguage)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path === 'metadata.language')).toBe(true)
    })

    it('should return error for empty categories', () => {
      const emptyCategories = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  language: go
  categories: []
`
      const { manifest, errors } = parseManifest(emptyCategories)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path === 'metadata.categories')).toBe(true)
    })
  })

  describe('variable validation', () => {
    it('should return error for variable without key', () => {
      const noKey = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  language: go
  categories:
    - api-service
variables:
  - type: string
    required: true
`
      const { manifest, errors } = parseManifest(noKey)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path.includes('key'))).toBe(true)
    })

    it('should return error for invalid variable type', () => {
      const invalidType = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  language: go
  categories:
    - api-service
variables:
  - key: TEST
    type: invalid
    required: true
`
      const { manifest, errors } = parseManifest(invalidType)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path.includes('type'))).toBe(true)
    })

    it('should return error for select without options', () => {
      const selectNoOptions = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  language: go
  categories:
    - api-service
variables:
  - key: REGION
    type: select
    required: true
`
      const { manifest, errors } = parseManifest(selectNoOptions)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path.includes('options'))).toBe(true)
    })

    it('should return error for multiselect without options', () => {
      const multiselectNoOptions = `
apiVersion: orbit/v1
kind: Template
metadata:
  name: Test
  language: go
  categories:
    - api-service
variables:
  - key: FEATURES
    type: multiselect
    required: true
`
      const { manifest, errors } = parseManifest(multiselectNoOptions)
      expect(manifest).toBeNull()
      expect(errors.some(e => e.path.includes('options'))).toBe(true)
    })
  })
})
