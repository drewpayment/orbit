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

// Defaults can be overridden via env vars or the bifrost-config Payload collection.
// Env vars (useful for K8s configmaps):
//   BIFROST_ADVERTISED_HOST  - gateway endpoint (default: traefik.orbit.orb.local:9092)
//   BIFROST_ROUTING_MODE     - sasl | sni | both (default: sasl)
//   BIFROST_TLS_ENABLED      - true | false (default: false)
//   BIFROST_CONNECTION_MODE  - bifrost | direct (default: bifrost)
const DEFAULT_CONFIG: BifrostConfigData = {
  advertisedHost: process.env.BIFROST_ADVERTISED_HOST || 'traefik.orbit.orb.local:9092',
  defaultAuthMethod: 'SASL/SCRAM-SHA-256',
  connectionMode: (process.env.BIFROST_CONNECTION_MODE as BifrostConfigData['connectionMode']) || 'bifrost',
  routingMode: (process.env.BIFROST_ROUTING_MODE as BifrostConfigData['routingMode']) || 'sasl',
  tlsEnabled: process.env.BIFROST_TLS_ENABLED === 'true',
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
