// Tool category classification + content parsing.
//
// The proto ConversationTurn currently doesn't carry the tool name on
// the wire (it's an internal Go field — see Phase 2 follow-up), so the
// UI categorizes tool turns from the JSON content shape. Each tool we
// surface emits a stable top-level key set we can match on.

export type ToolCategory =
  | 'orbit'
  | 'git'
  | 'shell'
  | 'http'
  | 'read'
  | 'unknown'

export type ToolStatus = 'ok' | 'error' | 'running' | 'unknown'

export type ToolView =
  | { kind: 'kv'; rows: Array<[string, string]> }
  | { kind: 'files'; rows: Array<{ name: string; size?: string; perm?: string; isDir?: boolean }> }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'error'; message: string; detail?: string }
  | { kind: 'json'; text: string }

export interface ParsedToolTurn {
  category: ToolCategory
  toolName: string | null
  arg: string | null
  summary: string | null
  status: ToolStatus
  view: ToolView
  raw: string
}

interface ParsedJson {
  ok: boolean
  data: Record<string, unknown> | null
  raw: string
}

function tryParseJson(content: string): ParsedJson {
  const trimmed = content.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return { ok: false, data: null, raw: content }
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) as Record<string, unknown>, raw: content }
  } catch {
    return { ok: false, data: null, raw: content }
  }
}

function shortenSha(sha: string): string {
  return sha.length > 12 ? sha.slice(0, 12) : sha
}

function formatBytes(n: number | string | undefined): string {
  if (n == null) return ''
  return String(n)
}

// Heuristic detector. Returns the most specific match; never throws.
export function parseToolTurn(content: string, opts: { toolName?: string } = {}): ParsedToolTurn {
  const parsed = tryParseJson(content)
  const explicitTool = opts.toolName?.trim() || null

  const fallback: ParsedToolTurn = {
    category: 'unknown',
    toolName: explicitTool,
    arg: null,
    summary: null,
    status: 'unknown',
    view: parsed.ok
      ? { kind: 'json', text: JSON.stringify(parsed.data, null, 2) }
      : { kind: 'json', text: content },
    raw: content,
  }

  if (!parsed.ok || !parsed.data) return fallback
  const data = parsed.data

  // Top-level error envelope our workflow uses for tool failures.
  const errStr = typeof data.error === 'string' ? data.error : null
  if (errStr) {
    const toolFromErr = typeof data.tool === 'string' ? data.tool : null
    const category = toolFromErr ? categoryFor(toolFromErr) : 'unknown'
    return {
      category,
      toolName: explicitTool || toolFromErr,
      arg: null,
      summary: firstLine(errStr),
      status: 'error',
      view: {
        kind: 'error',
        message: firstLine(errStr),
        detail: errStr.length > 120 ? errStr : undefined,
      },
      raw: content,
    }
  }

  // orbit_get_app result
  if (data.app && typeof data.app === 'object') {
    const app = data.app as Record<string, unknown>
    const rows: Array<[string, string]> = []
    if (app.name) rows.push(['name', String(app.name)])
    if (app.status) rows.push(['status', String(app.status)])
    const repo = app.repository as Record<string, unknown> | undefined
    if (repo?.url) rows.push(['repo', String(repo.url)])
    if (repo?.branch) rows.push(['branch', String(repo.branch)])
    const hc = app.health_config as Record<string, unknown> | undefined
    if (hc?.method && hc?.expectedStatus && hc?.interval) {
      rows.push([
        'health check',
        `${hc.method} / · expect ${hc.expectedStatus} · every ${hc.interval}s`,
      ])
    }
    return {
      category: 'orbit',
      toolName: explicitTool || 'orbit_get_app',
      arg: app.name ? String(app.name) : null,
      summary: app.name
        ? `${app.name}${repo?.branch ? ' · ' + repo.branch : ''}${app.status ? ' · ' + app.status : ''}`
        : null,
      status: 'ok',
      view: { kind: 'kv', rows },
      raw: content,
    }
  }

  // orbit_list_apps result
  if (Array.isArray(data.apps)) {
    const apps = data.apps as Array<Record<string, unknown>>
    return {
      category: 'orbit',
      toolName: explicitTool || 'orbit_list_apps',
      arg: null,
      summary: `${apps.length} app${apps.length === 1 ? '' : 's'} in workspace`,
      status: 'ok',
      view: {
        kind: 'kv',
        rows: apps.map((a, i): [string, string] => [
          `[${i}] ${a.name ?? a.id ?? '?'}`,
          String(a.status ?? ''),
        ]),
      },
      raw: content,
    }
  }

  // orbit_list_cloud_accounts result
  if (Array.isArray(data.accounts)) {
    const accounts = data.accounts as Array<Record<string, unknown>>
    return {
      category: 'orbit',
      toolName: explicitTool || 'orbit_list_cloud_accounts',
      arg: null,
      summary: `${accounts.length} cloud account${accounts.length === 1 ? '' : 's'} connected`,
      status: 'ok',
      view: {
        kind: 'kv',
        rows: accounts.map((a, i): [string, string] => [
          `[${i}] ${a.name ?? '?'}`,
          `${a.provider ?? '?'} · ${a.region ?? ''} · ${a.status ?? ''}`,
        ]),
      },
      raw: content,
    }
  }

  // orbit_repo_clone result
  if (typeof data.clone_path === 'string' && typeof data.head_sha === 'string') {
    return {
      category: 'git',
      toolName: explicitTool || 'orbit_repo_clone',
      arg:
        data.owner && data.repo
          ? `${data.owner}/${data.repo}${data.branch ? '@' + data.branch : ''}`
          : null,
      summary: `Cloned to ${data.clone_path} · ${shortenSha(String(data.head_sha))}`,
      status: 'ok',
      view: {
        kind: 'kv',
        rows: ([
          ['branch', String(data.branch ?? '')],
          ['head sha', shortenSha(String(data.head_sha))],
          ['clone path', String(data.clone_path)],
          ['installation', String(data.installation_id ?? '')],
          [
            'duration',
            typeof data.duration_ms === 'number'
              ? `${(data.duration_ms / 1000).toFixed(2)}s`
              : '',
          ],
        ] satisfies Array<[string, string]>).filter(([, v]) => v !== ''),
      },
      raw: content,
    }
  }

  // shell_exec / SandboxedShell result
  if (
    typeof data.exit_code === 'number' ||
    typeof data.stdout === 'string' ||
    typeof data.stderr === 'string'
  ) {
    const exit = data.exit_code as number | undefined
    const status: ToolStatus = exit === undefined ? 'ok' : exit === 0 ? 'ok' : 'error'
    const stdout = typeof data.stdout === 'string' ? data.stdout : ''
    const stderr = typeof data.stderr === 'string' ? data.stderr : ''
    return {
      category: 'shell',
      toolName: explicitTool || 'shell_exec',
      arg: null,
      summary:
        status === 'error'
          ? `Exit ${exit} · ${firstLine(stderr || stdout)}`
          : firstLine(stdout) || 'Completed',
      status,
      view:
        status === 'error'
          ? { kind: 'error', message: `Exit ${exit}`, detail: stderr || stdout }
          : { kind: 'code', text: stdout || stderr || '(no output)' },
      raw: content,
    }
  }

  // http_request result
  if (
    (typeof data.status === 'number' || typeof data.status_code === 'number') &&
    (typeof data.body === 'string' || data.headers != null)
  ) {
    const code = (data.status_code ?? data.status) as number
    const status: ToolStatus = code >= 200 && code < 400 ? 'ok' : 'error'
    return {
      category: 'http',
      toolName: explicitTool || 'http_request',
      arg: null,
      summary: `HTTP ${code}${data.duration_ms ? ' · ' + data.duration_ms + 'ms' : ''}`,
      status,
      view: {
        kind: 'json',
        text: JSON.stringify(data, null, 2),
      },
      raw: content,
    }
  }

  // read_file result
  if (typeof data.content === 'string' && (data.path || data.size != null)) {
    const path = String(data.path ?? '')
    return {
      category: 'read',
      toolName: explicitTool || 'read_file',
      arg: path || null,
      summary: `${formatBytes(data.size as number | string | undefined)} bytes${path ? ' · ' + path : ''}`,
      status: 'ok',
      view: { kind: 'code', text: data.content as string, lang: inferLang(path) },
      raw: content,
    }
  }

  // list_dir result
  if (Array.isArray(data.entries)) {
    const entries = data.entries as Array<Record<string, unknown>>
    return {
      category: 'read',
      toolName: explicitTool || 'list_dir',
      arg: typeof data.path === 'string' ? data.path : null,
      summary: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
      status: 'ok',
      view: {
        kind: 'files',
        rows: entries.map((e) => ({
          name: String(e.name ?? ''),
          size: e.size != null ? String(e.size) : undefined,
          isDir: Boolean(e.is_dir),
        })),
      },
      raw: content,
    }
  }

  // generic — show the raw JSON in the body, use explicit tool name if known
  return {
    ...fallback,
    category: explicitTool ? categoryFor(explicitTool) : 'unknown',
    status: 'ok',
  }
}

export function categoryFor(toolName: string): ToolCategory {
  if (toolName.startsWith('orbit_')) return 'orbit'
  if (toolName === 'repo_inspect' || toolName === 'orbit_repo_clone') return 'git'
  if (toolName === 'shell_exec') return 'shell'
  if (toolName === 'http_request') return 'http'
  if (toolName === 'read_file' || toolName === 'list_dir' || toolName === 'write_file')
    return 'read'
  return 'unknown'
}

function firstLine(s: string): string {
  if (!s) return ''
  const idx = s.indexOf('\n')
  return (idx === -1 ? s : s.slice(0, idx)).trim()
}

function inferLang(path: string): string | undefined {
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.go')) return 'go'
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml'
  if (path.endsWith('.md')) return 'markdown'
  return undefined
}
