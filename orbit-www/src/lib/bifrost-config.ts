import { getPayload } from 'payload'
import config from '@payload-config'

export type BifrostConfigData = {
  advertisedHost: string
  defaultAuthMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  connectionMode: 'bifrost' | 'direct'
  tlsEnabled: boolean
}

const DEFAULT_CONFIG: BifrostConfigData = {
  advertisedHost: 'localhost:9092',
  defaultAuthMethod: 'SASL/SCRAM-SHA-256',
  connectionMode: 'bifrost',
  tlsEnabled: true,
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
