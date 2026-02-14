// orbit-www/src/types/api-catalog.ts

export interface APISchema {
  id: string
  name: string
  slug: string
  description?: string
  workspace: string | { id: string; slug: string; name?: string }
  visibility: 'private' | 'workspace' | 'public'
  schemaType: 'openapi'
  currentVersion?: string
  rawContent?: string
  status: 'draft' | 'published' | 'deprecated'
  tags?: Array<{ id?: string; tag: string }>
  contactName?: string
  contactEmail?: string
  serverUrls?: Array<{ id?: string; url: string }>
  repository?: string | { id: string }
  repositoryPath?: string
  specTitle?: string
  specDescription?: string
  endpointCount?: number
  latestVersionNumber?: number
  createdBy?: string | { id: string; name?: string; email?: string }
  lastEditedBy?: string | { id: string }
  createdAt: string
  updatedAt: string
}

export interface APISchemaVersion {
  id: string
  schema: string | APISchema
  workspace: string | { id: string }
  version: string
  versionNumber: number
  rawContent?: string
  contentHash?: string
  releaseNotes?: string
  createdBy?: string | { id: string; name?: string; email?: string }
  createdAt: string
  updatedAt: string
}
