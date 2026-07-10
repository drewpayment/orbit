/**
 * Azure DevOps repo URL helpers, shared by the import server action (parsing a
 * pasted/derived clone URL) and the import form (constructing one from a picked
 * repo). Kept host-agnostic so on-prem Azure DevOps Server URLs work alongside
 * dev.azure.com without a per-host allowlist.
 *
 * The canonical ADO repo coordinate is org/project/repo, expressed in a clone
 * URL as `{host…}/{org}/{project}/_git/{repo}`. The `_git` segment is the stable
 * anchor: the segment after it is the repo, the two before it are project then
 * organization. That holds for both `https://dev.azure.com/{org}/{project}/_git/{repo}`
 * and on-prem `https://{host}/{collection}/{project}/_git/{repo}` (collection = org).
 */

export interface AdoRepoCoordinate {
  organization: string
  project: string
  repo: string
}

/**
 * Parse an Azure DevOps `_git` repo URL into org/project/repo, or return null
 * when the URL is not an ADO repo URL (e.g. a GitHub URL, or missing `_git`).
 * Host-agnostic: works for dev.azure.com and on-prem Azure DevOps Server.
 */
export function parseAdoRepoUrl(rawUrl: string): AdoRepoCoordinate | null {
  let pathname: string
  try {
    pathname = new URL(rawUrl).pathname
  } catch {
    return null
  }

  const segments = pathname
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })

  const gitIdx = segments.indexOf('_git')
  // Need org, project before `_git` and repo after it.
  if (gitIdx < 2 || gitIdx + 1 >= segments.length) return null

  const organization = segments[gitIdx - 2]
  const project = segments[gitIdx - 1]
  const repo = segments[gitIdx + 1].replace(/\.git$/, '')
  if (!organization || !project || !repo) return null

  return { organization, project, repo }
}

/**
 * Build an Azure DevOps clone/browse URL from a repo coordinate. `baseUrl` is
 * the connection's base (default `https://dev.azure.com`; an on-prem base
 * already carries the host and any collection prefix, with `organization` as the
 * next segment).
 */
export function buildAdoRepoUrl(
  baseUrl: string,
  organization: string,
  project: string,
  repo: string,
): string {
  const base = (baseUrl || 'https://dev.azure.com').replace(/\/+$/, '')
  return `${base}/${organization}/${project}/_git/${repo}`
}
