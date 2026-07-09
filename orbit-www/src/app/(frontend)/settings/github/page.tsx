import { permanentRedirect } from 'next/navigation'

/**
 * The former GitHub App installations page was merged into the unified
 * Connections page (WI3). Kept as a permanent redirect so bookmarks and any
 * lingering deep links resolve.
 */
export default function GitHubSettingsRedirect() {
  permanentRedirect('/settings/connections')
}
