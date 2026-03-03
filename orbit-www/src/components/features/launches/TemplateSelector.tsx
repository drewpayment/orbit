'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, ArrowLeft, Clock, Info } from 'lucide-react'
import type { Provider } from './ProviderSelector'
import type { TemplateDoc } from './LaunchWizard'

const categoryLabels: Record<string, string> = {
  compute: 'Compute',
  storage: 'Storage',
  database: 'Database',
  networking: 'Networking',
  container: 'Container',
  serverless: 'Serverless',
}

interface TemplateSelectorProps {
  templates: TemplateDoc[]
  provider: Provider
  onSelect: (template: TemplateDoc) => void
  onBack: () => void
}

export function TemplateSelector({ templates, provider, onSelect, onBack }: TemplateSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const providerTemplates = useMemo(
    () => templates.filter((t) => t.provider === provider),
    [templates, provider],
  )

  const bundles = useMemo(
    () => providerTemplates.filter((t) => t.type === 'bundle'),
    [providerTemplates],
  )

  const resources = useMemo(
    () => providerTemplates.filter((t) => t.type === 'resource'),
    [providerTemplates],
  )

  const categories = useMemo(() => {
    const cats = new Set(providerTemplates.map((t) => t.category))
    return Array.from(cats).sort()
  }, [providerTemplates])

  function filterTemplates(list: TemplateDoc[]) {
    return list.filter((t) => {
      const matchesSearch =
        searchQuery === '' ||
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter
      return matchesSearch && matchesCategory
    })
  }

  function renderTemplateGrid(list: TemplateDoc[]) {
    const filtered = filterTemplates(list)
    if (filtered.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          No templates match your search criteria.
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((template) => {
          const crossProvider = Array.isArray(template.crossProviderSlugs) && template.crossProviderSlugs.length > 0

          return (
            <Card
              key={template.id}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => onSelect(template)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <Badge variant="outline">{categoryLabels[template.category] || template.category}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {template.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {template.estimatedDuration && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {template.estimatedDuration}
                    </span>
                  )}
                  {crossProvider && (
                    <span className="flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Multi-provider
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  const providerLabels: Record<string, string> = {
    aws: 'AWS',
    gcp: 'GCP',
    azure: 'Azure',
    digitalocean: 'DigitalOcean',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">
            Select Template — {providerLabels[provider]}
          </h2>
          <p className="text-muted-foreground mt-1">
            Choose an infrastructure template to deploy
          </p>
        </div>
      </div>

      {/* Search and filter */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {categories.length > 1 && (
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {categoryLabels[cat] || cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Tabs: Bundles / Individual Resources */}
      <Tabs defaultValue="bundles">
        <TabsList>
          <TabsTrigger value="bundles">
            Bundles ({bundles.length})
          </TabsTrigger>
          <TabsTrigger value="resources">
            Individual Resources ({resources.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="bundles">
          {renderTemplateGrid(bundles)}
        </TabsContent>
        <TabsContent value="resources">
          {renderTemplateGrid(resources)}
        </TabsContent>
      </Tabs>
    </div>
  )
}
