// orbit-www/src/types/api-catalog.ts

export interface APISchema {
  id: string
  name: string
  slug: string
  description?: string | null
  workspace: string | { id: string; slug: string; name?: string }
  visibility: 'private' | 'workspace' | 'public'
  schemaType: 'openapi'
  currentVersion?: string | null
  rawContent?: string | null
  status: 'draft' | 'published' | 'deprecated'
  tags?: Array<{ id?: string | null; tag: string }> | null
  contactName?: string | null
  contactEmail?: string | null
  serverUrls?: Array<{ id?: string | null; url: string }> | null
  repository?: string | { id: string } | null
  repositoryPath?: string | null
  specTitle?: string | null
  specDescription?: string | null
  endpointCount?: number | null
  latestVersionNumber?: number | null
  createdBy?: string | { id: string; name?: string | null; email?: string | null } | null
  lastEditedBy?: string | { id: string } | null
  createdAt: string
  updatedAt: string
}

export interface APISchemaVersion {
  id: string
  schema: string | APISchema
  workspace: string | { id: string }
  version: string
  versionNumber: number
  rawContent?: string | null
  contentHash?: string | null
  releaseNotes?: string | null
  createdBy?: string | { id: string; name?: string | null; email?: string | null } | null
  createdAt: string
  updatedAt: string
}
