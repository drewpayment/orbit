'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, Code2, GitBranch, Users } from 'lucide-react'
import { TemplateCatalogFilters, type TemplateFilters } from './TemplateCatalogFilters'

// Language to emoji mapping
const languageEmoji: Record<string, string> = {
  typescript: '🔷',
  javascript: '🟨',
  go: '🔵',
  python: '🐍',
  rust: '🦀',
  java: '☕',
  ruby: '💎',
  php: '🐘',
  csharp: '🟪',
  swift: '🍎',
}

// Complexity badge colors
const complexityColors: Record<string, string> = {
  starter: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  'production-ready': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

interface Template {
  id: string
  name: string
  slug: string
  description?: string | null
  language?: string | null
  framework?: string | null
  complexity?: string | null
  categories?: string[] | null
  tags?: Array<{ tag: string }> | null
  defaultBranch?: string | null
  usageCount?: number | null
}

interface TemplateCatalogProps {
  templates: Template[]
}

export function TemplateCatalog({ templates }: TemplateCatalogProps) {
  const [filters, setFilters] = useState<TemplateFilters>({
    search: '',
    language: 'all',
    category: 'all',
    complexity: 'all',
  })

  // Extract unique languages from templates
  const languages = useMemo(() => {
    const langs = new Set<string>()
    templates.forEach((t) => {
      if (t.language) langs.add(t.language)
    })
    return Array.from(langs).sort()
  }, [templates])

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        const matchesSearch =
          template.name.toLowerCase().includes(searchLower) ||
          template.description?.toLowerCase().includes(searchLower) ||
          template.language?.toLowerCase().includes(searchLower) ||
          template.framework?.toLowerCase().includes(searchLower) ||
          template.tags?.some((t) => t.tag.toLowerCase().includes(searchLower))
        if (!matchesSearch) return false
      }

      // Language filter
      if (filters.language !== 'all') {
        if (template.language?.toLowerCase() !== filters.language) return false
      }

      // Category filter
      if (filters.category !== 'all') {
        if (!template.categories?.includes(filters.category)) return false
      }

      // Complexity filter
      if (filters.complexity !== 'all') {
        if (template.complexity !== filters.complexity) return false
      }

      return true
    })
  }, [templates, filters])

  return (
    <div className="space-y-6">
      {/* Filters */}
      <TemplateCatalogFilters
        filters={filters}
        onFiltersChange={setFilters}
        languages={languages}
      />

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        Showing {filteredTemplates.length} of {templates.length} templates
      </p>

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Code2 className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Templates Found</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {templates.length === 0
                ? 'Import your first template from GitHub to get started.'
                : 'Try adjusting your filters to find templates.'}
            </p>
            {templates.length === 0 && (
              <Button asChild>
                <Link href="/templates/import">
                  <Plus className="mr-2 h-4 w-4" />
                  Import Template
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => {
            const tags = template.tags || []
            const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'

            return (
              <Link key={template.id} href={`/templates/${template.slug}`}>
                <Card className="h-full transition-all hover:shadow-lg hover:border-primary cursor-pointer">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{emoji}</span>
                        <CardTitle className="text-xl">{template.name}</CardTitle>
                      </div>
                      {template.complexity && (
                        <Badge
                          variant="secondary"
                          className={complexityColors[template.complexity] || ''}
                        >
                          {template.complexity}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{template.language}</span>
                      {template.framework && (
                        <>
                          <span>•</span>
                          <span>{template.framework}</span>
                        </>
                      )}
                    </div>
                    {template.description && (
                      <CardDescription className="line-clamp-2 mt-2">
                        {template.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    {/* Tags */}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {tags.slice(0, 4).map((t, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {t.tag}
                          </Badge>
                        ))}
                        {tags.length > 4 && (
                          <Badge variant="outline" className="text-xs">
                            +{tags.length - 4}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <GitBranch className="h-4 w-4" />
                        <span>{template.defaultBranch}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        <span>Used {template.usageCount || 0} times</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
