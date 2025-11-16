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
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  return await githubApp.getInstallationOctokit(installationId)
}

/**
 * Create installation access token
 */
export async function createInstallationToken(installationId: number) {
  // Use the App-level octokit to create installation access tokens
  const { data } = await githubApp.octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    {
      installation_id: installationId,
    },
  )

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
