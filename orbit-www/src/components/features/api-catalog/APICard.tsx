'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Globe, Lock, Users, FileCode, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface APICardProps {
  id: string
  name: string
  description?: string
  version?: string
  status: 'draft' | 'published' | 'deprecated'
  visibility: 'private' | 'workspace' | 'public'
  workspaceName?: string
  endpointCount?: number
  tags?: Array<{ tag: string }>
  updatedAt: string
  href?: string
}

const visibilityIcons = {
  private: <Lock className="h-3.5 w-3.5" />,
  workspace: <Users className="h-3.5 w-3.5" />,
  public: <Globe className="h-3.5 w-3.5" />,
}

const visibilityLabels = {
  private: 'Private',
  workspace: 'Workspace',
  public: 'Public',
}

const statusColors = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  published: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  deprecated: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export function APICard({
  id,
  name,
  description,
  version,
  status,
  visibility,
  workspaceName,
  endpointCount,
  tags,
  updatedAt,
  href,
}: APICardProps) {
  const cardContent = (
    <Card className="h-full transition-colors hover:bg-muted/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{name}</CardTitle>
            {workspaceName && (
              <p className="text-xs text-muted-foreground mt-1">{workspaceName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {version && (
              <Badge variant="outline" className="text-xs">
                {version}
              </Badge>
            )}
            <Badge className={`text-xs ${statusColors[status]}`}>
              {status}
            </Badge>
          </div>
        </div>
        {description && (
          <CardDescription className="line-clamp-2 mt-2">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            {visibilityIcons[visibility]}
            <span>{visibilityLabels[visibility]}</span>
          </div>
          {endpointCount !== undefined && (
            <div className="flex items-center gap-1">
              <FileCode className="h-3.5 w-3.5" />
              <span>{endpointCount} endpoint{endpointCount !== 1 ? 's' : ''}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}</span>
          </div>
        </div>
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {tags.slice(0, 3).map((t) => (
              <Badge key={t.tag} variant="secondary" className="text-xs">
                {t.tag}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {cardContent}
      </Link>
    )
  }

  return (
    <Link href={`/catalog/apis/${id}`} className="block">
      {cardContent}
    </Link>
  )
}
