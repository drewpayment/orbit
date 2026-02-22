import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import fs from 'fs'

const GITHUB_APP_ID = process.env.GITHUB_APP_ID!
const GITHUB_APP_PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH
const GITHUB_APP_PRIVATE_KEY_BASE64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64

if (!GITHUB_APP_ID) {
  throw new Error('GITHUB_APP_ID environment variable required')
}

// Load private key from file or base64 env var
let privateKey: string
if (GITHUB_APP_PRIVATE_KEY_BASE64) {
  privateKey = Buffer.from(GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8')
} else if (GITHUB_APP_PRIVATE_KEY_PATH) {
  privateKey = fs.readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf-8')
} else {
  throw new Error('Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY_BASE64 required')
}

// Create GitHub App instance
export const githubApp = new App({
  appId: GITHUB_APP_ID,
  privateKey: privateKey,
})

/**
 * Get Octokit instance for a specific installation
 */
export async function getInstallationOctokit(installationId: number) {
  return await githubApp.getInstallationOctokit(installationId)
}

/**
 * Create installation access token with specified permissions
 * @param installationId - The GitHub App installation ID
 * @param options - Optional settings for token creation
 * @param options.includePackages - If true, requests packages:write permission for GHCR access
 * @param options.requireContentsWrite - If true, requests contents:write permission for committing to repos
 */
export async function createInstallationToken(
  installationId: number,
  options?: { includePackages?: boolean; requireContentsWrite?: boolean }
) {
  // Build the request payload
  const requestOptions: {
    installation_id: number
    permissions?: { packages?: 'read' | 'write'; contents?: 'read' | 'write'; metadata?: 'read' | 'write' }
  } = {
    installation_id: installationId,
  }

  // If packages permission is requested, include it explicitly
  // This is required for pushing to GitHub Container Registry (GHCR)
  if (options?.includePackages) {
    requestOptions.permissions = {
      packages: 'write' as const,
      contents: 'read' as const, // Needed for cloning repos
      metadata: 'read' as const, // Basic repo info
    }
  } else if (options?.requireContentsWrite) {
    requestOptions.permissions = {
      contents: 'write' as const,
      metadata: 'read' as const,
    }
  }

  // Use the App-level octokit to create installation access tokens
  console.log('[GitHub] Creating installation token', {
    installation_id: requestOptions.installation_id,
    permissions: requestOptions.permissions,
  })

  const { data } = await githubApp.octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    requestOptions,
  )

  console.log('[GitHub] Token created', {
    expiresAt: data.expires_at,
    permissions: data.permissions,
  })

  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  }
}

/**
 * Get installation details from GitHub
 */
export async function getInstallation(installationId: number) {
  // Use the App-level octokit to access the Apps API via request
  const { data } = await githubApp.octokit.request('GET /app/installations/{installation_id}', {
    installation_id: installationId,
  })

  return data
}
