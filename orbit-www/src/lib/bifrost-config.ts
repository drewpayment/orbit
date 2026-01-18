import { getPayload } from 'payload'
import config from '@payload-config'

export type BifrostConfigData = {
  advertisedHost: string
  defaultAuthMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  connectionMode: 'bifrost' | 'direct'
  tlsEnabled: boolean
}

// Default Bifrost endpoint - can be overridden via BIFROST_ADVERTISED_HOST env var
// For Orbstack local dev: traefik.orbit.orb.local:9092
// For production: Set via bifrost-config collection or env var
const getDefaultAdvertisedHost = () => {
  return process.env.BIFROST_ADVERTISED_HOST || 'traefik.orbit.orb.local:9092'
}

const DEFAULT_CONFIG: BifrostConfigData = {
  advertisedHost: getDefaultAdvertisedHost(),
  defaultAuthMethod: 'SASL/SCRAM-SHA-256',
  connectionMode: 'bifrost',
  tlsEnabled: false, // Local dev uses SASL_PLAINTEXT
}

export async function getBifrostConfig(): Promise<BifrostConfigData> {
  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'bifrost-config',
    limit: 1,
    overrideAccess: true,
  })

  if (result.docs.length === 0) {
    return DEFAULT_CONFIG
  }

  const doc = result.docs[0]
  return {
    advertisedHost: doc.advertisedHost || DEFAULT_CONFIG.advertisedHost,
    defaultAuthMethod: (doc.defaultAuthMethod as BifrostConfigData['defaultAuthMethod']) || DEFAULT_CONFIG.defaultAuthMethod,
    connectionMode: (doc.connectionMode as BifrostConfigData['connectionMode']) || DEFAULT_CONFIG.connectionMode,
    tlsEnabled: doc.tlsEnabled ?? DEFAULT_CONFIG.tlsEnabled,
  }
}
