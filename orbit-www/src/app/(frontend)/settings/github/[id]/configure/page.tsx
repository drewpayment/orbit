import { permanentRedirect } from 'next/navigation'

/**
 * Workspace assignment moved from this standalone sub-page into the in-page
 * dialog on the unified Connections page (WI2/WI3). Kept as a permanent
 * redirect so `[id]` deep links resolve.
 */
export default function ConfigureInstallationRedirect() {
  permanentRedirect('/settings/connections')
}
