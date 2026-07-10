import * as yaml from 'yaml'
import { parse as parseGraphQL, Kind } from 'graphql'
import { parseAppManifest, mapManifestToAppFields } from '@/lib/app-manifest'

// --- Types ---

export interface EvidenceBundle {
  /** Full file list for the repo scope (relative paths, no leading slash). */
  tree: string[]
  /** Fetched well-known files keyed by relative path. Subset of `tree`. */
  files: Record<string, string>
}

export interface EvidenceEntry {
  detector: string
  file: string
  excerpt?: string
}

export interface Detection {
  kind: 'service' | 'api'
  confidence: 'high' | 'medium' | 'low'
  name: string
  /** Repo-relative directory scope (`''` = repo root). */
  path: string
  evidence: EvidenceEntry[]
  proposal: Record<string, unknown>
}

/**
 * Well-known paths/globs the Go scanner must fetch so these detectors have
 * content to work with.
 *
 * KEEP IN SYNC with the fetch list in
 * `temporal-workflows/internal/activities/catalog_scan_activities.go`.
 * Any pattern added here must be fetched there, or the corresponding detector
 * silently downgrades to a filename-only (medium) match or misses entirely.
 */
export const DISCOVERY_FETCH_PATTERNS: string[] = [
  // Tier 1 self-declaring manifests
  '.orbit.yaml',
  '.orbit.yml',
  // API specs (root + common doc/api locations)
  'openapi.yaml',
  'openapi.yml',
  'openapi.json',
  'swagger.yaml',
  'swagger.yml',
  'swagger.json',
  'asyncapi.yaml',
  'asyncapi.yml',
  'asyncapi.json',
  'api/openapi.yaml',
  'api/openapi.yml',
  'api/openapi.json',
  'docs/openapi.yaml',
  'docs/openapi.yml',
  'docs/openapi.json',
  'api/asyncapi.yaml',
  'docs/asyncapi.yaml',
  'schema.graphql',
  '**/*.graphql',
  '**/*.gql',
  // Containerization signals
  'Dockerfile',
  '**/Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'k8s/**',
  'kubernetes/**',
  'deploy/**',
  'manifests/**',
  // Build manifests (language/framework)
  'package.json',
  '**/package.json',
  'go.mod',
  '**/go.mod',
  'pom.xml',
  '**/pom.xml',
  'Cargo.toml',
  '**/Cargo.toml',
  'pyproject.toml',
  '**/pyproject.toml',
  'requirements.txt',
  '**/requirements.txt',
  // Ownership
  'CODEOWNERS',
  '.github/CODEOWNERS',
  'docs/CODEOWNERS',
]

// --- Path helpers ---

/**
 * Vendored / generated directories that must never yield detections — a repo
 * with committed node_modules would otherwise propose every dependency as a
 * "service" (observed live: 300+ spam proposals from one repo). Keep in sync
 * with the Go scanner's path filter in
 * temporal-workflows/internal/activities/catalog_scan_activities.go.
 */
const VENDORED_SEGMENT_RE =
  /(^|\/)(node_modules|vendor|bower_components|third_party|\.git|dist|build|out|\.next|\.nuxt|target|__pycache__|site-packages|\.venv|venv|coverage|\.terraform)(\/|$)/

export function isVendoredPath(path: string): boolean {
  return VENDORED_SEGMENT_RE.test(path)
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

function baseOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx === -1 ? name : name.slice(0, idx)
}

// --- API spec sniffing (shared with the api-schemas beforeValidate hook) ---

export type ApiSchemaType = 'openapi' | 'asyncapi'

export interface SpecMetadata {
  /** `null` when the content parses but is not a recognized spec. */
  schemaType: ApiSchemaType | null
  hasInfo: boolean
  title: string | null
  description: string | null
  version: string | null
  hasContact: boolean
  contactName: string | null
  contactEmail: string | null
  /** `null` when the spec has no `servers` array. */
  serverUrls: string[] | null
  /** `null` when no counting basis (paths/channels) is present. */
  endpointCount: number | null
}

/**
 * Parse an OpenAPI/Swagger/AsyncAPI document and derive the metadata the
 * catalog cares about. Returns `null` when the content cannot be parsed as
 * YAML/JSON — this is the single sniffing implementation reused by the
 * `api-schemas` beforeValidate hook, so behavior there must not diverge.
 */
export function extractSpecMetadata(rawContent: string): SpecMetadata | null {
  let spec: Record<string, unknown> | undefined
  try {
    spec = yaml.parse(rawContent) as Record<string, unknown> | undefined
  } catch {
    return null
  }
  if (!spec || typeof spec !== 'object') return null

  let schemaType: ApiSchemaType | null = null
  if (spec.asyncapi) {
    schemaType = 'asyncapi'
  } else if (spec.openapi || spec.swagger) {
    schemaType = 'openapi'
  }

  const info = spec.info as Record<string, unknown> | undefined
  const hasInfo = !!info && typeof info === 'object'
  const contact = hasInfo ? (info!.contact as Record<string, unknown> | undefined) : undefined
  const hasContact = !!contact && typeof contact === 'object'

  let serverUrls: string[] | null = null
  if (Array.isArray(spec.servers)) {
    serverUrls = (spec.servers as { url: string }[]).map((s) => s.url)
  }

  let endpointCount: number | null = null
  if (schemaType === 'asyncapi') {
    if (spec.channels && typeof spec.channels === 'object') {
      endpointCount = Object.keys(spec.channels as object).length
    }
  } else if (spec.paths && typeof spec.paths === 'object') {
    let count = 0
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']
    for (const path of Object.values(spec.paths as object)) {
      if (path && typeof path === 'object') {
        for (const method of methods) {
          if (method in (path as object)) count++
        }
      }
    }
    endpointCount = count
  }

  return {
    schemaType,
    hasInfo,
    title: hasInfo ? ((info!.title as string) || null) : null,
    description: hasInfo ? ((info!.description as string) || null) : null,
    version: hasInfo ? ((info!.version as string) || null) : null,
    hasContact,
    contactName: hasContact ? ((contact!.name as string) || null) : null,
    contactEmail: hasContact ? ((contact!.email as string) || null) : null,
    serverUrls,
    endpointCount,
  }
}

export interface GraphQLSpecMetadata {
  /** Total fields across top-level Query/Mutation/Subscription type definitions. */
  endpointCount: number
}

const GRAPHQL_ROOT_TYPE_NAMES = new Set(['Query', 'Mutation', 'Subscription'])

/**
 * Parse GraphQL SDL and derive the metadata the catalog cares about. Returns
 * `null` when the content does not parse as GraphQL — this is the
 * GraphQL-analog of `extractSpecMetadata` (which is YAML-based and cannot
 * read SDL), reused by the `api-schemas` beforeValidate hook.
 */
export function extractGraphQLMetadata(rawContent: string): GraphQLSpecMetadata | null {
  let doc
  try {
    doc = parseGraphQL(rawContent)
  } catch {
    return null
  }

  let endpointCount = 0
  for (const def of doc.definitions) {
    if (def.kind === Kind.OBJECT_TYPE_DEFINITION && GRAPHQL_ROOT_TYPE_NAMES.has(def.name.value)) {
      endpointCount += def.fields?.length ?? 0
    }
  }

  return { endpointCount }
}

// --- detectOrbitManifest ---

const ORBIT_MANIFEST_PATHS = ['.orbit.yaml', '.orbit.yml']

export function detectOrbitManifest(bundle: EvidenceBundle): Detection[] {
  for (const manifestPath of ORBIT_MANIFEST_PATHS) {
    const content = bundle.files[manifestPath]
    if (content === undefined) continue

    const { manifest } = parseAppManifest(content)
    if (!manifest) continue

    const fields = mapManifestToAppFields(manifest)
    const proposal: Record<string, unknown> = {
      name: fields.name,
      manifestPath,
    }
    if (fields.description !== undefined) proposal.description = fields.description
    if (fields.healthConfig) proposal.healthConfig = fields.healthConfig
    if (fields.buildConfig) proposal.buildConfig = fields.buildConfig

    return [
      {
        kind: 'service',
        confidence: 'high',
        name: manifest.metadata.name,
        path: '',
        evidence: [{ detector: 'orbit-manifest', file: manifestPath }],
        proposal,
      },
    ]
  }
  return []
}

// --- detectApiSpecs ---

interface ApiFilenameMatch {
  schemaType: 'openapi' | 'asyncapi' | 'graphql'
}

function matchApiFilename(path: string): ApiFilenameMatch | null {
  const base = baseOf(path).toLowerCase()
  if (/(^|[.-])openapi\.(ya?ml|json)$/.test(base) || /(^|[.-])swagger\.(ya?ml|json)$/.test(base)) {
    return { schemaType: 'openapi' }
  }
  if (/(^|[.-])asyncapi\.(ya?ml|json)$/.test(base)) {
    return { schemaType: 'asyncapi' }
  }
  if (base.endsWith('.graphql') || base.endsWith('.gql')) {
    return { schemaType: 'graphql' }
  }
  return null
}

const GRAPHQL_SDL_RE = /\b(type|schema|input|enum|interface|union)\s+\w|\bextend\s+type\b/

function isGraphqlSdl(content: string): boolean {
  return GRAPHQL_SDL_RE.test(content)
}

export function detectApiSpecs(bundle: EvidenceBundle): Detection[] {
  const detections: Detection[] = []
  const seen = new Set<string>()

  const emit = (path: string, d: Detection) => {
    if (seen.has(path)) return
    seen.add(path)
    detections.push(d)
  }

  // Content-backed matches first (highest fidelity).
  for (const [path, content] of Object.entries(bundle.files)) {
    if (isVendoredPath(path)) continue
    const match = matchApiFilename(path)
    if (!match) continue

    if (match.schemaType === 'graphql') {
      const high = isGraphqlSdl(content)
      emit(path, {
        kind: 'api',
        confidence: high ? 'high' : 'medium',
        name: stripExt(baseOf(path)),
        path: dirOf(path),
        evidence: [{ detector: 'api-spec', file: path, excerpt: 'graphql schema' }],
        proposal: { schemaType: 'graphql', specPath: path, rawContent: content },
      })
      continue
    }

    const meta = extractSpecMetadata(content)
    const confirmed = !!meta && meta.schemaType !== null
    const schemaType = confirmed ? meta!.schemaType! : match.schemaType
    const title = meta?.title ?? undefined
    emit(path, {
      kind: 'api',
      confidence: confirmed ? 'high' : 'medium',
      name: title || stripExt(baseOf(path)),
      path: dirOf(path),
      evidence: [{ detector: 'api-spec', file: path, excerpt: title }],
      proposal: {
        schemaType,
        specPath: path,
        ...(title ? { specTitle: title } : {}),
        rawContent: content,
      },
    })
  }

  // Filename-only matches from the tree (no content fetched -> medium).
  for (const path of bundle.tree) {
    if (seen.has(path) || isVendoredPath(path)) continue
    const match = matchApiFilename(path)
    if (!match) continue
    emit(path, {
      kind: 'api',
      confidence: 'medium',
      name: stripExt(baseOf(path)),
      path: dirOf(path),
      evidence: [{ detector: 'api-spec', file: path }],
      proposal: { schemaType: match.schemaType, specPath: path },
    })
  }

  return detections
}

// --- detectService ---

interface BuildManifestInfo {
  language: string
  framework?: string
  name?: string
}

function frameworkFromNodeDeps(deps: Record<string, unknown>): string | undefined {
  if (deps.next) return 'nextjs'
  if (deps['@nestjs/core']) return 'nestjs'
  if (deps['@angular/core']) return 'angular'
  if (deps.express) return 'express'
  if (deps.fastify) return 'fastify'
  if (deps.svelte) return 'svelte'
  if (deps.vue) return 'vue'
  if (deps.react) return 'react'
  return undefined
}

function analyzePackageJson(content: string): BuildManifestInfo {
  const info: BuildManifestInfo = { language: 'nodejs' }
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>
    if (typeof pkg.name === 'string') info.name = pkg.name
    const deps = {
      ...((pkg.dependencies as Record<string, unknown>) || {}),
      ...((pkg.devDependencies as Record<string, unknown>) || {}),
    }
    info.framework = frameworkFromNodeDeps(deps)
  } catch {
    // Malformed package.json — language is still nodejs.
  }
  return info
}

function analyzeGoMod(content: string): BuildManifestInfo {
  const info: BuildManifestInfo = { language: 'go' }
  const m = content.match(/^module\s+(\S+)/m)
  if (m) info.name = baseOf(m[1])
  if (/\bgithub\.com\/gin-gonic\/gin\b/.test(content)) info.framework = 'gin'
  else if (/\bgithub\.com\/gofiber\/fiber\b/.test(content)) info.framework = 'fiber'
  else if (/\bgithub\.com\/labstack\/echo\b/.test(content)) info.framework = 'echo'
  else if (/\bgithub\.com\/go-chi\/chi\b/.test(content)) info.framework = 'chi'
  return info
}

function analyzePython(content: string): BuildManifestInfo {
  const info: BuildManifestInfo = { language: 'python' }
  const nameMatch = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m)
  if (nameMatch) info.name = nameMatch[1]
  const lower = content.toLowerCase()
  if (lower.includes('fastapi')) info.framework = 'fastapi'
  else if (lower.includes('django')) info.framework = 'django'
  else if (lower.includes('flask')) info.framework = 'flask'
  return info
}

function analyzePomXml(content: string): BuildManifestInfo {
  const info: BuildManifestInfo = { language: 'java' }
  const m = content.match(/<artifactId>([^<]+)<\/artifactId>/)
  if (m) info.name = m[1].trim()
  if (content.includes('spring-boot')) info.framework = 'spring-boot'
  return info
}

function analyzeCargoToml(content: string): BuildManifestInfo {
  const info: BuildManifestInfo = { language: 'rust' }
  const m = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m)
  if (m) info.name = m[1]
  return info
}

const BUILD_MANIFEST_FILES = new Set([
  'package.json',
  'go.mod',
  'pom.xml',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
])

function analyzeBuildManifest(base: string, content: string | undefined): BuildManifestInfo | null {
  switch (base) {
    case 'package.json':
      return content ? analyzePackageJson(content) : { language: 'nodejs' }
    case 'go.mod':
      return content ? analyzeGoMod(content) : { language: 'go' }
    case 'pom.xml':
      return content ? analyzePomXml(content) : { language: 'java' }
    case 'Cargo.toml':
      return content ? analyzeCargoToml(content) : { language: 'rust' }
    case 'pyproject.toml':
    case 'requirements.txt':
      return content ? analyzePython(content) : { language: 'python' }
    default:
      return null
  }
}

function isContainerFile(base: string): boolean {
  return (
    base === 'Dockerfile' ||
    base === 'docker-compose.yml' ||
    base === 'docker-compose.yaml' ||
    base === 'compose.yml' ||
    base === 'compose.yaml'
  )
}

const K8S_DIR_RE = /(^|\/)(k8s|kubernetes|deploy|manifests)\//

interface ServiceScope {
  container?: EvidenceEntry
  build?: { entry: EvidenceEntry; info: BuildManifestInfo }
  k8s?: EvidenceEntry
}

export function detectService(bundle: EvidenceBundle): Detection[] {
  const scopes = new Map<string, ServiceScope>()
  const scopeOf = (path: string): ServiceScope => {
    const dir = dirOf(path)
    let scope = scopes.get(dir)
    if (!scope) {
      scope = {}
      scopes.set(dir, scope)
    }
    return scope
  }

  for (const path of bundle.tree) {
    if (isVendoredPath(path)) continue
    const base = baseOf(path)
    if (isContainerFile(base)) {
      scopeOf(path).container ??= { detector: 'container', file: path }
    } else if (BUILD_MANIFEST_FILES.has(base)) {
      const info = analyzeBuildManifest(base, bundle.files[path])
      if (info) {
        const scope = scopeOf(path)
        if (!scope.build) scope.build = { entry: { detector: 'build-manifest', file: path }, info }
      }
    } else if (K8S_DIR_RE.test(path)) {
      // Anchor a k8s scope at the parent of the k8s/… directory.
      const dir = path.replace(K8S_DIR_RE, (m, p1) => (p1 ? p1 : '')).replace(/\/.*$/, '')
      const anchor = dir === path ? dirOf(path) : dir
      let scope = scopes.get(anchor)
      if (!scope) {
        scope = {}
        scopes.set(anchor, scope)
      }
      scope.k8s ??= { detector: 'k8s-manifest', file: path }
    }
  }

  const detections: Detection[] = []
  for (const [dir, scope] of scopes) {
    const hasContainer = !!scope.container || !!scope.k8s
    const hasBuild = !!scope.build
    if (!hasContainer && !hasBuild) continue

    const evidence: EvidenceEntry[] = []
    if (scope.container) evidence.push(scope.container)
    if (scope.k8s) evidence.push(scope.k8s)
    if (scope.build) evidence.push(scope.build.entry)

    const signalCount = (hasContainer ? 1 : 0) + (hasBuild ? 1 : 0)
    const confidence: Detection['confidence'] = signalCount >= 2 ? 'high' : 'medium'

    const info = scope.build?.info
    const name = info?.name || (dir ? baseOf(dir) : 'service')
    const buildConfig: Record<string, unknown> = {}
    if (info?.language) buildConfig.language = info.language
    if (info?.framework) buildConfig.framework = info.framework

    detections.push({
      kind: 'service',
      confidence,
      name,
      path: dir,
      evidence,
      proposal: {
        name,
        ...(Object.keys(buildConfig).length > 0 ? { buildConfig } : {}),
      },
    })
  }

  return detections
}

// --- detectOwnershipHints ---

const CODEOWNERS_PATHS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']

function parseCodeownersOwners(content: string): string[] {
  const owners = new Set<string>()
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/).slice(1)
    for (const part of parts) {
      if (part.startsWith('@') || part.includes('@')) owners.add(part)
    }
  }
  return [...owners]
}

export function detectOwnershipHints(bundle: EvidenceBundle): EvidenceEntry[] {
  const hints: EvidenceEntry[] = []
  for (const path of CODEOWNERS_PATHS) {
    const content = bundle.files[path]
    if (content === undefined) continue
    const owners = parseCodeownersOwners(content)
    if (owners.length === 0) continue
    hints.push({ detector: 'codeowners', file: path, excerpt: owners.join(', ') })
  }
  return hints
}

// --- runDetectors ---

export function runDetectors(bundle: EvidenceBundle): Detection[] {
  const orbit = detectOrbitManifest(bundle)
  const heuristicServices = detectService(bundle)
  const apis = detectApiSpecs(bundle)
  const ownership = detectOwnershipHints(bundle)

  // An orbit manifest is authoritative for its path; drop the heuristic
  // service that would otherwise duplicate it.
  const orbitPaths = new Set(orbit.map((d) => d.path))
  const services = [...orbit, ...heuristicServices.filter((d) => !orbitPaths.has(d.path))]

  if (ownership.length > 0) {
    for (const service of services) {
      service.evidence = [...service.evidence, ...ownership]
    }
  }

  return [...services, ...apis]
}
