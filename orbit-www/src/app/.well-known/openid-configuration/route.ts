import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider"
// eslint-disable-next-line no-restricted-imports -- Better-Auth OIDC metadata API (oauthProviderOpenIdConfigMetadata(auth)), not a session read
import { auth } from "@/lib/auth"

export const GET = oauthProviderOpenIdConfigMetadata(auth)
