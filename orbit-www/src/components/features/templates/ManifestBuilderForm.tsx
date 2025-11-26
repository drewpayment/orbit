'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Copy, Check, GitCommit, Loader2, Plus, Trash2 } from 'lucide-react'
import { generateManifestYaml, ManifestFormData } from '@/lib/template-manifest'
import { commitManifestToRepo } from '@/app/actions/templates'

interface ManifestBuilderFormProps {
  repoUrl: string
  workspaceId: string
  repoInfo: {
    owner: string
    repo: string
    defaultBranch: string
    description: string | null
  }
  onManifestCreated: () => void // Called after manifest is committed
  onCancel: () => void
}

const LANGUAGE_GROUPS = [
  {
    label: 'Programming Languages',
    options: [
      { value: 'typescript', label: 'TypeScript' },
      { value: 'javascript', label: 'JavaScript' },
      { value: 'go', label: 'Go' },
      { value: 'python', label: 'Python' },
      { value: 'rust', label: 'Rust' },
      { value: 'java', label: 'Java' },
      { value: 'ruby', label: 'Ruby' },
      { value: 'php', label: 'PHP' },
      { value: 'csharp', label: 'C#' },
      { value: 'kotlin', label: 'Kotlin' },
      { value: 'swift', label: 'Swift' },
      { value: 'scala', label: 'Scala' },
    ],
  },
  {
    label: 'Infrastructure & DevOps',
    options: [
      { value: 'kubernetes', label: 'Kubernetes (YAML)' },
      { value: 'terraform', label: 'Terraform (HCL)' },
      { value: 'ansible', label: 'Ansible' },
      { value: 'helm', label: 'Helm Charts' },
      { value: 'pulumi', label: 'Pulumi' },
      { value: 'cloudformation', label: 'CloudFormation' },
      { value: 'docker', label: 'Dockerfile' },
      { value: 'kustomize', label: 'Kustomize' },
    ],
  },
  {
    label: 'Configuration & Data',
    options: [
      { value: 'yaml', label: 'YAML/Config' },
      { value: 'json', label: 'JSON' },
      { value: 'markdown', label: 'Markdown/Docs' },
      { value: 'shell', label: 'Shell Scripts' },
    ],
  },
  {
    label: 'Other',
    options: [
      { value: 'other', label: 'Other (specify below)' },
    ],
  },
]

const FRAMEWORKS = [
  // Web Frameworks
  'nextjs', 'react', 'vue', 'angular', 'svelte', 'astro',
  // Backend
  'express', 'fastapi', 'django', 'flask', 'gin', 'fiber', 'rails', 'laravel', 'spring', 'nestjs',
  // Mobile
  'react-native', 'flutter', 'expo',
  // Infrastructure
  'flux', 'argocd', 'crossplane',
]
const CATEGORIES = [
  { value: 'api-service', label: 'API Service' },
  { value: 'frontend-app', label: 'Frontend App' },
  { value: 'backend-service', label: 'Backend Service' },
  { value: 'cli-tool', label: 'CLI Tool' },
  { value: 'library', label: 'Library' },
  { value: 'mobile-app', label: 'Mobile App' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'monorepo', label: 'Monorepo' },
]

export function ManifestBuilderForm({ repoUrl, workspaceId, repoInfo, onManifestCreated, onCancel }: ManifestBuilderFormProps) {
  // Form state
  const [name, setName] = useState(repoInfo.repo)
  const [description, setDescription] = useState(repoInfo.description || '')
  const [language, setLanguage] = useState('')
  const [customLanguage, setCustomLanguage] = useState('')
  const [framework, setFramework] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [complexity, setComplexity] = useState<'starter' | 'intermediate' | 'production-ready' | ''>('')
  const [variables, setVariables] = useState<ManifestFormData['variables']>([])

  // UI state
  const [committing, setCommitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get effective language (use custom if "other" selected)
  const effectiveLanguage = language === 'other' ? customLanguage : language

  // Generate YAML from current form state
  const generateYaml = () => {
    const data: ManifestFormData = {
      name,
      description: description || undefined,
      language: effectiveLanguage,
      framework: framework || undefined,
      categories,
      tags: tags.length > 0 ? tags : undefined,
      complexity: complexity || undefined,
      variables: variables?.length ? variables : undefined,
    }
    return generateManifestYaml(data)
  }

  const yamlContent = generateYaml()

  // Validation
  const isValid = name && effectiveLanguage && categories.length > 0

  // Handle commit to repo
  const handleCommit = async () => {
    if (!isValid) return
    setCommitting(true)
    setError(null)

    try {
      const result = await commitManifestToRepo({
        repoUrl,
        workspaceId,
        manifestContent: yamlContent,
      })

      if (result.success) {
        onManifestCreated()
      } else {
        setError(result.error || 'Failed to commit manifest')
      }
    } catch (e) {
      setError('Network error while committing')
    } finally {
      setCommitting(false)
    }
  }

  // Handle copy
  const handleCopy = async () => {
    await navigator.clipboard.writeText(yamlContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Handle adding a tag
  const addTag = () => {
    if (tagInput && !tags.includes(tagInput)) {
      setTags([...tags, tagInput])
      setTagInput('')
    }
  }

  // Handle category toggle
  const toggleCategory = (cat: string) => {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  // Add variable
  const addVariable = () => {
    setVariables([...(variables || []), {
      key: '',
      type: 'string',
      required: false,
    }])
  }

  // Remove variable
  const removeVariable = (index: number) => {
    setVariables(variables?.filter((_, i) => i !== index))
  }

  // Update variable
  const updateVariable = (index: number, field: string, value: unknown) => {
    setVariables(variables?.map((v, i) => i === index ? { ...v, [field]: value } : v))
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Template Manifest</CardTitle>
          <CardDescription>
            This repository does not have an orbit-template.yaml file. Fill out the form below to create one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Info */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Template"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Language / Type *</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language or type" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_GROUPS.map(group => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.options.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {language === 'other' && (
                <Input
                  placeholder="Enter custom language/type..."
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of this template..."
              rows={3}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="framework">Framework</Label>
              <Select value={framework} onValueChange={setFramework}>
                <SelectTrigger>
                  <SelectValue placeholder="Select framework (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {FRAMEWORKS.map(fw => (
                    <SelectItem key={fw} value={fw}>{fw}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="complexity">Complexity</Label>
              <Select value={complexity} onValueChange={(v) => setComplexity(v as 'starter' | 'intermediate' | 'production-ready' | '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select complexity (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="production-ready">Production Ready</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label>Categories *</Label>
            <p className="text-sm text-muted-foreground">Select at least one category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(cat => (
                <Badge
                  key={cat.value}
                  variant={categories.includes(cat.value) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleCategory(cat.value)}
                >
                  {cat.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add a tag..."
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              />
              <Button type="button" variant="outline" onClick={addTag}>Add</Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => setTags(tags.filter(t => t !== tag))}>
                    {tag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Variables (collapsible section) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Template Variables</Label>
              <Button type="button" variant="outline" size="sm" onClick={addVariable}>
                <Plus className="h-4 w-4 mr-1" /> Add Variable
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Define variables that users will fill in when using this template</p>

            {variables && variables.length > 0 && (
              <div className="space-y-3 mt-3">
                {variables.map((v, i) => (
                  <div key={i} className="flex gap-2 items-start p-3 border rounded-lg">
                    <div className="flex-1 grid gap-2 md:grid-cols-4">
                      <Input
                        placeholder="VARIABLE_KEY"
                        value={v.key}
                        onChange={(e) => updateVariable(i, 'key', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                      />
                      <Select value={v.type} onValueChange={(val) => updateVariable(i, 'type', val)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">String</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="boolean">Boolean</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Description"
                        value={v.description || ''}
                        onChange={(e) => updateVariable(i, 'description', e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={v.required}
                          onChange={(e) => updateVariable(i, 'required', e.target.checked)}
                          id={`req-${i}`}
                        />
                        <label htmlFor={`req-${i}`} className="text-sm">Required</label>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeVariable(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview & Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Generated Manifest</CardTitle>
          <CardDescription>Preview of your orbit-template.yaml file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono">
            {yamlContent}
          </pre>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? 'Copied!' : 'Copy YAML'}
            </Button>
            <Button onClick={handleCommit} disabled={!isValid || committing}>
              {committing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <GitCommit className="h-4 w-4 mr-2" />
              )}
              Commit to Repository
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
