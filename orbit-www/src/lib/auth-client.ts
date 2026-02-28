import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { getEnv } from "@/lib/env"

let _client: ReturnType<typeof createAuthClient> | null = null

function getAuthClient() {
  if (!_client) {
    _client = createAuthClient({
      baseURL: getEnv('NEXT_PUBLIC_APP_URL') || "http://localhost:3000",
      plugins: [oauthProviderClient()],
    })
  }
  return _client
}

// Lazy proxy ensures window.__RUNTIME_ENV is available before client creation
export const authClient = new Proxy({} as ReturnType<typeof createAuthClient>, {
  get(_, prop) {
    return (getAuthClient() as any)[prop]
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
