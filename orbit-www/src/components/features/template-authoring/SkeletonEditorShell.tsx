/**
 * Skeleton editor shell — Template Authoring Phase 3, Task 3
 * (`docs/plans/2026-09-10-template-authoring-phase-3-greenfield-content.md`
 * §3.4).
 *
 * The one client component that owns a `template-skeletons` bundle's draft
 * state: name/slug/description, the file list, and which file is selected.
 * A pure `buildFileTree` (`skeleton-file-tree.ts`) turns the flat file list
 * into a tree for the left-hand browser; `languageForPath`
 * (`skeleton-editor-lang.ts`) infers the Monaco `language` for the selected
 * file.
 *
 * **Client pre-check, not the real gate.** Save is disabled with an inline
 * message whenever `validateSkeletonBundle` — the SAME pure function the
 * collection's `beforeValidate` hook runs server-side — reports a
 * violation. This is a convenience: `createSkeleton`/`saveSkeleton` run the
 * real hook again on the server and their own errors are surfaced
 * regardless of what this pre-check concluded, exactly like the publish gate
 * in `TemplateEditorShell.tsx`.
 *
 * **Delimiter hint.** File CONTENT is rendered later by `fs:render` using
 * Go `text/template` single-brace syntax (`{{ .key }}` / `{{KEY}}`) — a
 * different layer from a template DEFINITION's `${{ }}` expressions. Get
 * this copy right; a wrong hint actively misleads authors (plan §3.4).
 */
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Editor from '@monaco-editor/react'
import { File, FileText, Folder, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { validateSkeletonBundle } from '@/lib/scaffolder/skeleton-bundle'
import { buildFileTree, type FileTreeNode } from './skeleton-file-tree'
import { languageForPath } from './skeleton-editor-lang'
import type {
  CreateSkeletonInput,
  SaveSkeletonInput,
  SkeletonActionResult,
  SkeletonDetail,
} from '@/app/(frontend)/self-service/templates/skeletons/skeleton-actions'

export interface SkeletonEditorActions {
  createSkeleton: (input: CreateSkeletonInput) => Promise<SkeletonActionResult<{ id: string }>>
  saveSkeleton: (id: string, input: SaveSkeletonInput) => Promise<SkeletonActionResult<{ id: string }>>
}

export interface SkeletonEditorShellProps {
  mode: 'create' | 'edit'
  workspaceId: string
  /** The persisted skeleton, for `mode: 'edit'`. Ignored in `mode: 'create'`. */
  skeleton: SkeletonDetail | null
  actions: SkeletonEditorActions
}

interface DraftFile {
  path: string
  content: string
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** `1,234` style with the unit suffixed — used for the "N/50 files" and byte counters. */
function formatCount(n: number): string {
  return n.toLocaleString()
}

function formatKB(bytes: number): string {
  return Math.round(bytes / 1000).toLocaleString()
}

export function SkeletonEditorShell({ mode, workspaceId, skeleton, actions }: SkeletonEditorShellProps) {
  const router = useRouter()

  const [name, setName] = React.useState(skeleton?.name ?? '')
  const [slug, setSlug] = React.useState(skeleton?.slug ?? '')
  const [slugTouched, setSlugTouched] = React.useState(Boolean(skeleton))
  const [description, setDescription] = React.useState(skeleton?.description ?? '')
  const [files, setFiles] = React.useState<DraftFile[]>(skeleton?.files ?? [])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(skeleton?.files[0]?.path ?? null)
  const [newFilePath, setNewFilePath] = React.useState('')
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [serverErrors, setServerErrors] = React.useState<string[]>([])

  // Keep the slug in sync with the name until the author edits it directly
  // (mirrors NewTemplateForm's convention), but never in edit mode — an
  // existing skeleton's slug must not silently drift when its name changes.
  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched && mode === 'create') setSlug(slugify(value))
  }

  const precheck = React.useMemo(() => validateSkeletonBundle(files), [files])
  const selectedFile = files.find((f) => f.path === selectedPath) ?? null

  function updateSelectedContent(content: string) {
    if (!selectedPath) return
    setFiles((prev) => prev.map((f) => (f.path === selectedPath ? { ...f, content } : f)))
  }

  function addFile() {
    const path = newFilePath.trim()
    if (!path) return
    if (files.some((f) => f.path === path)) {
      setServerErrors([`A file already exists at "${path}".`])
      return
    }
    setFiles((prev) => [...prev, { path, content: '' }])
    setSelectedPath(path)
    setNewFilePath('')
    setServerErrors([])
  }

  function deleteFile(path: string) {
    setFiles((prev) => prev.filter((f) => f.path !== path))
    if (selectedPath === path) setSelectedPath(null)
  }

  function startRename(path: string) {
    setRenamingPath(path)
    setRenameValue(path)
  }

  function commitRename(event: React.FormEvent) {
    event.preventDefault()
    const from = renamingPath
    const to = renameValue.trim()
    if (!from || !to) {
      setRenamingPath(null)
      return
    }
    setFiles((prev) => prev.map((f) => (f.path === from ? { ...f, path: to } : f)))
    if (selectedPath === from) setSelectedPath(to)
    setRenamingPath(null)
  }

  async function handleSave() {
    setServerErrors([])
    setPending(true)
    try {
      if (mode === 'create') {
        const result = await actions.createSkeleton({
          workspaceId,
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          files,
        })
        if (!result.ok) {
          setServerErrors(result.errors)
          return
        }
        router.push(`/self-service/templates/skeletons/${result.data.id}/edit`)
        return
      }

      if (!skeleton) return
      const result = await actions.saveSkeleton(skeleton.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        files,
      })
      if (!result.ok) {
        setServerErrors(result.errors)
        return
      }
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  const tree = React.useMemo(() => buildFileTree(files), [files])
  const saveDisabled = pending || !name.trim() || !slug.trim() || !precheck.ok

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="skeleton-name">Name</Label>
          <Input id="skeleton-name" value={name} onChange={(e) => handleNameChange(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="skeleton-slug">Slug</Label>
          <Input
            id="skeleton-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value)
            }}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="skeleton-description">Description</Label>
          <Input id="skeleton-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {serverErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {serverErrors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {!precheck.ok ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">Save is disabled until this bundle fits Orbit-hosted skeleton limits:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {precheck.errors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">
              For a larger or binary bundle, use a git-backed template instead (the <code>fetch:git</code> action)
              rather than an Orbit-hosted skeleton.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className={cn(files.length > 50 && 'font-medium text-destructive')}>
          {formatCount(files.length)}/50 files
        </span>
        <span aria-hidden>&middot;</span>
        <span className={cn(precheck.totalSize > 1_000_000 && 'font-medium text-destructive')}>
          {formatKB(precheck.totalSize)} KB / 1,000 KB
        </span>
      </div>

      {/*
        Fixed (not min-) height: @monaco-editor/react's <Editor> sizes to
        100% of its parent. Inside an unbounded `flex-1` column, Monaco
        reported an oversized intrinsic height that pushed the Save button
        far below the fold (caught by agent-browser verification). A fixed
        height bounds Monaco correctly at every viewport width.
      */}
      <div className="grid h-[480px] gap-4 md:grid-cols-[260px_1fr]">
        <div className="flex h-full min-h-0 flex-col gap-2 rounded-md border p-2">
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              addFile()
            }}
          >
            <div className="flex-1">
              <Label htmlFor="new-file-path" className="sr-only">
                New file path
              </Label>
              <Input
                id="new-file-path"
                placeholder="src/index.ts"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
              />
            </div>
            <Button type="submit" size="icon" variant="outline" aria-label="Add file">
              <Plus className="h-4 w-4" />
            </Button>
          </form>

          <div className="flex-1 overflow-auto">
            {tree.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">No files yet. Add one above.</p>
            ) : (
              <FileTreeView
                nodes={tree}
                selectedPath={selectedPath}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onSelect={setSelectedPath}
                onRenameStart={startRename}
                onRenameValueChange={setRenameValue}
                onRenameCommit={commitRename}
                onDelete={deleteFile}
              />
            )}
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border">
          {selectedFile ? (
            <Editor
              language={languageForPath(selectedFile.path)}
              value={selectedFile.content}
              onChange={(v) => updateSelectedContent(v ?? '')}
              options={{ minimap: { enabled: false }, fontSize: 13 }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Select a file to edit its content, or add a new one.
            </div>
          )}
        </div>
      </div>

      <Alert>
        <AlertDescription>
          <p data-testid="skeleton-hint-syntax">
            File contents are rendered later with Go <code>text/template</code> single-brace syntax — write{' '}
            <code>{'{{ .key }}'}</code> (or <code>{'{{KEY}}'}</code>) for a substitution.
          </p>
          <p data-testid="skeleton-hint-warning" className="mt-1">
            This is NOT the double-brace <code>{'${{ }}'}</code> expressions used at the template-definition
            level. Those are two different layers; using <code>{'${{ }}'}</code> inside a skeleton file will not
            be substituted.
          </p>
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveDisabled}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>
    </div>
  )
}

function FileTreeView({
  nodes,
  selectedPath,
  renamingPath,
  renameValue,
  onSelect,
  onRenameStart,
  onRenameValueChange,
  onRenameCommit,
  onDelete,
  depth = 0,
}: {
  nodes: FileTreeNode[]
  selectedPath: string | null
  renamingPath: string | null
  renameValue: string
  onSelect: (path: string) => void
  onRenameStart: (path: string) => void
  onRenameValueChange: (value: string) => void
  onRenameCommit: (event: React.FormEvent) => void
  onDelete: (path: string) => void
  depth?: number
}) {
  return (
    <ul className="space-y-0.5" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === 'dir' ? (
            <>
              <div className="flex items-center gap-1.5 px-1 py-1 text-sm text-muted-foreground">
                <Folder className="h-3.5 w-3.5" />
                {node.name}
              </div>
              <FileTreeView
                nodes={node.children}
                selectedPath={selectedPath}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onSelect={onSelect}
                onRenameStart={onRenameStart}
                onRenameValueChange={onRenameValueChange}
                onRenameCommit={onRenameCommit}
                onDelete={onDelete}
                depth={depth + 1}
              />
            </>
          ) : renamingPath === node.path ? (
            <form onSubmit={onRenameCommit} className="flex items-center gap-1 px-1 py-0.5">
              <Input
                autoFocus
                value={renameValue}
                onChange={(e) => onRenameValueChange(e.target.value)}
                className="h-7 text-sm"
              />
              <Button type="submit" size="sm" variant="ghost" className="h-7 px-2">
                Save
              </Button>
            </form>
          ) : (
            <div
              className={cn(
                'group flex items-center gap-1.5 rounded px-1 py-1 text-sm hover:bg-muted',
                selectedPath === node.path && 'bg-muted font-medium',
              )}
            >
              <button
                type="button"
                className="flex flex-1 items-center gap-1.5 text-left"
                onClick={() => onSelect(node.path)}
              >
                {node.name.toLowerCase().endsWith('.md') ? (
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Rename ${node.name}`}
                className="opacity-0 group-hover:opacity-100"
                onClick={() => onRenameStart(node.path)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${node.name}`}
                className="opacity-0 group-hover:opacity-100"
                onClick={() => onDelete(node.path)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
