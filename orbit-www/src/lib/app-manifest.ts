import * as yaml from 'yaml'

// --- Types ---

export interface AppManifest {
  apiVersion: 'orbit.dev/v1'
  kind: 'Application'
  metadata: {
    name: string
    description?: string
  }
  health?: {
    endpoint?: string
    interval?: number
    timeout?: number
    method?: string
    expectedStatus?: number
  }
  build?: {
    language?: string
    languageVersion?: string
    framework?: string
    buildCommand?: string
    startCommand?: string
    dockerfilePath?: string
  }
}

export interface ManifestValidationError {
  path: string
  message: string
}

/** Valid HTTP methods for health checks (matches Payload App type) */
type HealthCheckMethod = 'GET' | 'HEAD' | 'POST' | null

/** Payload App DB fields relevant to manifest sync */
export interface AppSyncFields {
  name: string
  description?: string | null
  healthConfig?: {
    url?: string | null
    interval?: number | null
    timeout?: number | null
    method?: HealthCheckMethod
    expectedStatus?: number | null
  } | null
  buildConfig?: {
    language?: string | null
    languageVersion?: string | null
    framework?: string | null
    buildCommand?: string | null
    startCommand?: string | null
    dockerfilePath?: string | null
  } | null
}

// --- Parsing ---

export function parseAppManifest(content: string): {
  manifest: AppManifest | null
  errors: ManifestValidationError[]
} {
  const errors: ManifestValidationError[] = []

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch (e) {
    return {
      manifest: null,
      errors: [{ path: '', message: `Invalid YAML: ${(e as Error).message}` }],
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { manifest: null, errors: [{ path: '', message: 'Manifest must be a YAML object' }] }
  }

  const doc = parsed as Record<string, unknown>

  if (doc.apiVersion !== 'orbit.dev/v1') {
    errors.push({ path: 'apiVersion', message: "apiVersion must be 'orbit.dev/v1'" })
  }

  if (doc.kind !== 'Application') {
    errors.push({ path: 'kind', message: "kind must be 'Application'" })
  }

  const metadata = doc.metadata as Record<string, unknown> | undefined
  if (!metadata || typeof metadata !== 'object') {
    errors.push({ path: 'metadata', message: 'metadata is required and must be an object' })
  } else if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push({ path: 'metadata.name', message: 'metadata.name is required and must be a string' })
  }

  if (errors.length > 0) {
    return { manifest: null, errors }
  }

  const manifest: AppManifest = {
    apiVersion: 'orbit.dev/v1',
    kind: 'Application',
    metadata: {
      name: (metadata as Record<string, unknown>).name as string,
      description: (metadata as Record<string, unknown>).description as string | undefined,
    },
  }

  if (doc.health && typeof doc.health === 'object') {
    const h = doc.health as Record<string, unknown>
    manifest.health = {
      endpoint: h.endpoint as string | undefined,
      interval: h.interval as number | undefined,
      timeout: h.timeout as number | undefined,
      method: h.method as string | undefined,
      expectedStatus: h.expectedStatus as number | undefined,
    }
  }

  if (doc.build && typeof doc.build === 'object') {
    const b = doc.build as Record<string, unknown>
    manifest.build = {
      language: b.language as string | undefined,
      languageVersion: b.languageVersion as string | undefined,
      framework: b.framework as string | undefined,
      buildCommand: b.buildCommand as string | undefined,
      startCommand: b.startCommand as string | undefined,
      dockerfilePath: b.dockerfilePath as string | undefined,
    }
  }

  return { manifest, errors: [] }
}

// --- Serialization ---

export function serializeAppManifest(fields: Partial<AppSyncFields>): string {
  const manifest = mapAppFieldsToManifest(fields)
  return yaml.stringify(manifest, { lineWidth: 0 })
}

// --- Mappers ---

export function mapManifestToAppFields(manifest: AppManifest): Partial<AppSyncFields> {
  const fields: Partial<AppSyncFields> = {
    name: manifest.metadata.name,
  }

  if (manifest.metadata.description) {
    fields.description = manifest.metadata.description
  }

  if (manifest.health) {
    const method = manifest.health.method?.toUpperCase()
    const validMethod: HealthCheckMethod =
      method === 'GET' || method === 'HEAD' || method === 'POST' ? method : null

    fields.healthConfig = {
      url: manifest.health.endpoint,
      interval: manifest.health.interval,
      timeout: manifest.health.timeout,
      method: validMethod,
      expectedStatus: manifest.health.expectedStatus,
    }
  }

  if (manifest.build) {
    fields.buildConfig = {
      language: manifest.build.language,
      languageVersion: manifest.build.languageVersion,
      framework: manifest.build.framework,
      buildCommand: manifest.build.buildCommand,
      startCommand: manifest.build.startCommand,
      dockerfilePath: manifest.build.dockerfilePath,
    }
  }

  return fields
}

export function mapAppFieldsToManifest(fields: Partial<AppSyncFields>): AppManifest {
  const manifest: AppManifest = {
    apiVersion: 'orbit.dev/v1',
    kind: 'Application',
    metadata: {
      name: fields.name || '',
    },
  }

  if (fields.description) {
    manifest.metadata.description = fields.description
  }

  if (fields.healthConfig?.url) {
    manifest.health = {
      endpoint: fields.healthConfig.url ?? undefined,
      interval: fields.healthConfig.interval ?? undefined,
      timeout: fields.healthConfig.timeout ?? undefined,
      method: fields.healthConfig.method ?? undefined,
      expectedStatus: fields.healthConfig.expectedStatus ?? undefined,
    }
  }

  if (fields.buildConfig?.language) {
    manifest.build = {
      language: fields.buildConfig.language ?? undefined,
      languageVersion: fields.buildConfig.languageVersion ?? undefined,
      framework: fields.buildConfig.framework ?? undefined,
      buildCommand: fields.buildConfig.buildCommand ?? undefined,
      startCommand: fields.buildConfig.startCommand ?? undefined,
      dockerfilePath: fields.buildConfig.dockerfilePath ?? undefined,
    }
  }

  return manifest
}
