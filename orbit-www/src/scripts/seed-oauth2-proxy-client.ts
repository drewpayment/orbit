// orbit-www/src/scripts/seed-oauth2-proxy-client.ts
//
// Registers the oauth2-proxy OIDC client with Better Auth's OAuth provider.
// Run once to obtain client_id and client_secret, then store them in Doppler
// as ORBIT_OAUTH2_PROXY_CLIENT_ID and ORBIT_OAUTH2_PROXY_CLIENT_SECRET.
//
// Usage: cd orbit-www && npx tsx src/scripts/seed-oauth2-proxy-client.ts
//
// Environment variables:
//   DATABASE_URI          - MongoDB connection string (required)
//   NEXT_PUBLIC_APP_URL   - Orbit app URL (default: http://localhost:3000)
//   TEMPORAL_UI_ORIGIN    - Temporal UI public URL (default: https://temporal.orbit.hoytlabs.app)

import 'dotenv/config'
import { auth } from '@/lib/auth'

const temporalUiOrigin =
  process.env.TEMPORAL_UI_ORIGIN || 'https://temporal.orbit.hoytlabs.app'

async function main() {
  console.log('Registering oauth2-proxy OIDC client...')
  console.log(`  Redirect URI: ${temporalUiOrigin}/oauth2/callback`)

  const client = await auth.api.adminCreateOAuthClient({
    headers: new Headers(),
    body: {
      redirect_uris: [`${temporalUiOrigin}/oauth2/callback`],
      client_name: 'oauth2-proxy (Temporal UI)',
      skip_consent: true,
      client_secret_expires_at: 0,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email',
      type: 'web',
    },
  })

  console.log('\n--- Save these values in Doppler ---')
  console.log(`ORBIT_OAUTH2_PROXY_CLIENT_ID=${client.client_id}`)
  console.log(`ORBIT_OAUTH2_PROXY_CLIENT_SECRET=${client.client_secret}`)
  console.log('-----------------------------------\n')
  console.log(
    'Store these as Doppler secrets, then the ExternalSecret will sync them to K8s.',
  )

  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to register oauth2-proxy client:', err)
  process.exit(1)
})
