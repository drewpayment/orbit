import { getPayload } from 'payload'
import config from '@payload-config'

export type BifrostConfigData = {
  // The gateway endpoint (used in SASL routing mode)
  advertisedHost: string
  defaultAuthMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  // Whether to route through Bifrost or connect directly to physical clusters
  connectionMode: 'bifrost' | 'direct'
  // How Bifrost routes to virtual clusters:
  // - 'sasl': Single gateway endpoint, routing based on SASL credentials (default for dev)
  // - 'sni': Per-cluster hostnames, routing based on TLS SNI (requires TLS + DNS)
  // - 'both': SNI when TLS available, falls back to SASL
  routingMode: 'sasl' | 'sni' | 'both'
  tlsEnabled: boolean
}

// Default Bifrost gateway endpoint - can be overridden via BIFROST_ADVERTISED_HOST env var
// For Orbstack local dev: traefik.orbit.orb.local:9092
// For production: Set via bifrost-config collection or env var
const getDefaultAdvertisedHost = () => {
  return process.env.BIFROST_ADVERTISED_HOST || 'traefik.orbit.orb.local:9092'
}

const DEFAULT_CONFIG: BifrostConfigData = {
  advertisedHost: getDefaultAdvertisedHost(),
  defaultAuthMethod: 'SASL/SCRAM-SHA-256',
  connectionMode: 'bifrost',
  routingMode: 'sasl', // Default to SASL-based routing for local dev
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
    routingMode: (doc.routingMode as BifrostConfigData['routingMode']) || DEFAULT_CONFIG.routingMode,
    tlsEnabled: doc.tlsEnabled ?? DEFAULT_CONFIG.tlsEnabled,
  }
}
