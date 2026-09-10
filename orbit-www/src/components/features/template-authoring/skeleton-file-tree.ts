/**
 * Pure file-tree builder for the skeleton editor's file browser (Template
 * Authoring Phase 3, Task 3). `template-skeletons` has no folders-as-first-
 * class-objects — a `path` with `/` segments (e.g. "src/lib/a.ts") renders
 * as a tree purely by grouping on those segments. No I/O, no framework
 * dependency, unit-tested in isolation.
 */

export interface FileTreeFileNode {
  type: 'file'
  name: string
  path: string
}

export interface FileTreeDirNode {
  type: 'dir'
  name: string
  path: string
  children: FileTreeNode[]
}

export type FileTreeNode = FileTreeFileNode | FileTreeDirNode

interface MutableDirNode {
  type: 'dir'
  name: string
  path: string
  children: Map<string, MutableDirNode | FileTreeFileNode>
}

function sortNodes(nodes: (MutableDirNode | FileTreeFileNode)[]): (MutableDirNode | FileTreeFileNode)[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function finalize(node: MutableDirNode): FileTreeDirNode {
  return {
    type: 'dir',
    name: node.name,
    path: node.path,
    children: sortNodes([...node.children.values()]).map((child) =>
      child.type === 'dir' ? finalize(child) : child,
    ),
  }
}

/**
 * Builds a nested tree from a flat list of file paths. Directories sort
 * before files at each level, then alphabetically within each group.
 * Malformed entries (empty path) are silently skipped rather than thrown —
 * the caller (the collection's own validation hook) is the authoritative
 * gate on path shape, this is a rendering helper only.
 */
export function buildFileTree(files: { path: string }[]): FileTreeNode[] {
  const root: MutableDirNode = { type: 'dir', name: '', path: '', children: new Map() }

  for (const file of files) {
    const path = typeof file.path === 'string' ? file.path : ''
    const segments = path.split('/').filter((s) => s.length > 0)
    if (segments.length === 0) continue

    let cursor = root
    let currentPath = ''
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLast = i === segments.length - 1

      if (isLast) {
        cursor.children.set(segment, { type: 'file', name: segment, path: currentPath })
        continue
      }

      const existing = cursor.children.get(segment)
      if (existing && existing.type === 'dir') {
        cursor = existing
      } else {
        const dir: MutableDirNode = { type: 'dir', name: segment, path: currentPath, children: new Map() }
        cursor.children.set(segment, dir)
        cursor = dir
      }
    }
  }

  return sortNodes([...root.children.values()]).map((child) =>
    child.type === 'dir' ? finalize(child) : child,
  )
}
