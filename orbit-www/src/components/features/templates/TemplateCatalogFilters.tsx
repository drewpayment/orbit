'use client'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface TemplateFilters {
  search: string
  language: string
  category: string
  complexity: string
}

interface TemplateCatalogFiltersProps {
  filters: TemplateFilters
  onFiltersChange: (filters: TemplateFilters) => void
  languages: string[]
}

const CATEGORIES = [
  { label: 'All Categories', value: 'all' },
  { label: 'API Service', value: 'api-service' },
  { label: 'Frontend App', value: 'frontend-app' },
  { label: 'Backend Service', value: 'backend-service' },
  { label: 'CLI Tool', value: 'cli-tool' },
  { label: 'Library', value: 'library' },
  { label: 'Mobile App', value: 'mobile-app' },
  { label: 'Infrastructure', value: 'infrastructure' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'Monorepo', value: 'monorepo' },
]

const COMPLEXITIES = [
  { label: 'All Complexities', value: 'all' },
  { label: 'Starter', value: 'starter' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Production Ready', value: 'production-ready' },
]

export function TemplateCatalogFilters({
  filters,
  onFiltersChange,
  languages,
}: TemplateCatalogFiltersProps) {
  const hasActiveFilters =
    filters.search || filters.language !== 'all' || filters.category !== 'all' || filters.complexity !== 'all'

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      language: 'all',
      category: 'all',
      complexity: 'all',
    })
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="pl-9"
        />
      </div>

      {/* Language Filter */}
      <Select
        value={filters.language}
        onValueChange={(value) => onFiltersChange({ ...filters, language: value })}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Languages</SelectItem>
          {languages.map((lang) => (
            <SelectItem key={lang} value={lang.toLowerCase()}>
              {lang}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Category Filter */}
      <Select
        value={filters.category}
        onValueChange={(value) => onFiltersChange({ ...filters, category: value })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {CATEGORIES.map((cat) => (
            <SelectItem key={cat.value} value={cat.value}>
              {cat.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Complexity Filter */}
      <Select
        value={filters.complexity}
        onValueChange={(value) => onFiltersChange({ ...filters, complexity: value })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Complexity" />
        </SelectTrigger>
        <SelectContent>
          {COMPLEXITIES.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  )
}
