'use client'

import React from 'react'
import { UseFormReturn } from 'react-hook-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Globe, Lock, Users, Server, FileCode, Tag, User, Mail } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import type { APIFormData } from './BasicInfoStep'

interface ReviewStepProps {
  form: UseFormReturn<APIFormData>
}

interface ParsedSpecInfo {
  title?: string
  version?: string
  description?: string
  contact?: {
    name?: string
    email?: string
  }
  servers?: Array<{ url: string; description?: string }>
  endpointCount: number
  paths: string[]
}

function parseSpecInfo(content: string): ParsedSpecInfo | null {
  try {
    const spec = parseYaml(content)
    if (!spec) return null

    // Count endpoints
    let endpointCount = 0
    const paths: string[] = []
    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths)) {
        paths.push(path)
        if (methods && typeof methods === 'object') {
          const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']
          for (const method of httpMethods) {
            if (method in methods) endpointCount++
          }
        }
      }
    }

    return {
      title: spec.info?.title,
      version: spec.info?.version,
      description: spec.info?.description,
      contact: spec.info?.contact,
      servers: spec.servers,
      endpointCount,
      paths: paths.slice(0, 5), // Show first 5 paths
    }
  } catch {
    return null
  }
}

const visibilityIcons = {
  private: <Lock className="h-4 w-4" />,
  workspace: <Users className="h-4 w-4" />,
  public: <Globe className="h-4 w-4" />,
}

const visibilityLabels = {
  private: 'Private',
  workspace: 'Workspace',
  public: 'Public',
}

export function ReviewStep({ form }: ReviewStepProps) {
  const formData = form.getValues()
  const specInfo = React.useMemo(
    () => parseSpecInfo(formData.rawContent),
    [formData.rawContent]
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Review Your API</CardTitle>
          <CardDescription>
            Please review the information below before creating your API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Info Section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Basic Information</h3>
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium">{formData.name || 'Not specified'}</span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-muted-foreground">Slug</span>
                <code className="text-sm bg-muted px-2 py-0.5 rounded">{formData.slug || 'Not specified'}</code>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-muted-foreground">Visibility</span>
                <div className="flex items-center gap-1.5">
                  {visibilityIcons[formData.visibility]}
                  <span className="text-sm font-medium">{visibilityLabels[formData.visibility]}</span>
                </div>
              </div>
              {formData.description && (
                <div>
                  <span className="text-sm text-muted-foreground block mb-1">Description</span>
                  <p className="text-sm">{formData.description}</p>
                </div>
              )}
              {formData.tags && formData.tags.length > 0 && (
                <div className="flex items-start gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {formData.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Spec Info Section */}
          {specInfo && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                <FileCode className="h-4 w-4 inline mr-1.5" />
                OpenAPI Specification
              </h3>
              <div className="space-y-3">
                {specInfo.title && (
                  <div className="flex items-start justify-between">
                    <span className="text-sm text-muted-foreground">Spec Title</span>
                    <span className="text-sm font-medium">{specInfo.title}</span>
                  </div>
                )}
                {specInfo.version && (
                  <div className="flex items-start justify-between">
                    <span className="text-sm text-muted-foreground">Version</span>
                    <Badge variant="outline">{specInfo.version}</Badge>
                  </div>
                )}
                <div className="flex items-start justify-between">
                  <span className="text-sm text-muted-foreground">Endpoints</span>
                  <span className="text-sm font-medium">{specInfo.endpointCount} endpoint{specInfo.endpointCount !== 1 ? 's' : ''}</span>
                </div>
                {specInfo.paths.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground block mb-2">Paths Preview</span>
                    <div className="bg-muted rounded-md p-3 space-y-1">
                      {specInfo.paths.map((path) => (
                        <code key={path} className="text-xs block text-muted-foreground">
                          {path}
                        </code>
                      ))}
                      {specInfo.paths.length < specInfo.endpointCount && (
                        <span className="text-xs text-muted-foreground">
                          ...and more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Contact Info */}
                {(specInfo.contact?.name || specInfo.contact?.email || formData.contactName || formData.contactEmail) && (
                  <div>
                    <span className="text-sm text-muted-foreground block mb-2">Contact</span>
                    <div className="space-y-1">
                      {(specInfo.contact?.name || formData.contactName) && (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {formData.contactName || specInfo.contact?.name}
                        </div>
                      )}
                      {(specInfo.contact?.email || formData.contactEmail) && (
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          {formData.contactEmail || specInfo.contact?.email}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Servers */}
                {specInfo.servers && specInfo.servers.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground block mb-2">
                      <Server className="h-4 w-4 inline mr-1.5" />
                      Servers
                    </span>
                    <div className="space-y-2">
                      {specInfo.servers.map((server, index) => (
                        <div key={index} className="bg-muted rounded-md p-2">
                          <code className="text-xs">{server.url}</code>
                          {server.description && (
                            <p className="text-xs text-muted-foreground mt-1">{server.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert className="bg-muted">
        <AlertDescription className="text-sm text-muted-foreground">
          After creation, this API will be available in the catalog based on your visibility settings.
          You can edit the specification at any time, and each change will create a new version.
        </AlertDescription>
      </Alert>
    </div>
  )
}
