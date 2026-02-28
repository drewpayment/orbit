import { createAuthClient } from "better-auth/react"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"

let _client: ReturnType<typeof createAuthClient> | null = null

function getBaseURL() {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
}

function getAuthClient() {
  if (!_client) {
    _client = createAuthClient({
      baseURL: getBaseURL(),
      plugins: [oauthProviderClient()],
    })
  }
  return _client
}

// Lazy proxy defers client creation until first use
export const authClient = new Proxy({} as ReturnType<typeof createAuthClient>, {
  get(_, prop) {
    return (getAuthClient() as any)[prop]
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
