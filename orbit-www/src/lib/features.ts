/**
 * Preview feature flags: single source of truth for UI surfaces that are
 * hidden because the backing implementation is stubbed, mocked, or not wired
 * to a real workflow yet.
 *
 * Hidden means: removed from nav/tabs/buttons AND the route returns
 * `notFound()` (see `assertFeatureEnabled`) so deep links don't expose broken
 * pages. Server actions behind a hidden feature refuse to run.
 *
 * Turn a feature back on by listing its key in the server-side env var
 * `ORBIT_ENABLE_PREVIEW_FEATURES` (comma separated), or `all`:
 *
 *   ORBIT_ENABLE_PREVIEW_FEATURES=billing,kafkaSchemas
 *
 * Server components, route gates and server actions read the variable at
 * runtime. Client components can't see it, so next.config.mjs mirrors it into
 * NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES at build time (used by the sidebar).
 * Prefer evaluating flags on the server and passing booleans to client
 * components as props.
 */
import { notFound } from 'next/navigation'

export interface PreviewFeature {
  /** Short user-facing name, used in docs and the README. */
  label: string
  /** Why the surface is hidden. */
  reason: string
  /** What has to happen before it can be shown again. */
  followUp: string
}

export const PREVIEW_FEATURES = {
  billing: {
    label: 'Billing & upgrade pages',
    reason: 'Static placeholder pages; no Stripe or subscription data behind them.',
    followUp: 'Wire a billing provider and real plan data.',
  },
  kafkaChargeback: {
    label: 'Kafka chargeback / billing',
    reason: 'Renders mock CSV data; the chargeback collections are unused.',
    followUp: 'Populate usage + cost collections and generate real reports.',
  },
  kafkaSchemas: {
    label: 'Kafka schema registry tabs',
    reason:
      'Schema actions return empty lists and registration starts SchemaValidationWorkflow, which is not registered in the Temporal worker.',
    followUp: 'Register the workflow in the worker and implement the schema gRPC calls.',
  },
  kafkaTopicMetrics: {
    label: 'Kafka topic metrics',
    reason: 'getTopicMetrics is a stub that always returns an empty list.',
    followUp: 'Implement metrics collection and the gRPC call.',
  },
  kafkaTopicSharing: {
    label: 'Workspace Kafka topic sharing tab',
    reason:
      'The topic-detail sharing actions are stubs (empty list, fake shares). Share-approval notifications only log to the console.',
    followUp: 'Move the tab onto the real kafka-topic-catalog share flow.',
  },
  legacyTemplates: {
    label: 'Legacy /templates instantiate + progress',
    reason:
      'Instantiation used random workflow IDs and simulated progress. The real flow is /self-service/templates.',
    followUp: 'Retire or rebuild on the self-service template runner.',
  },
  deployments: {
    label: 'Deployments UI',
    reason:
      'Creating a deployment only writes a DB row and starts no workflow; deployment generators are paused.',
    followUp: 'Resume the deployment generators and connect the workflow.',
  },
  digitalOceanLaunches: {
    label: 'DigitalOcean launches',
    reason:
      'The launch workflow dispatches to the launches_digitalocean task queue, but no DigitalOcean launches worker or launch templates ship in this repo.',
    followUp: 'Add a launches-worker-digitalocean and seed DigitalOcean launch templates.',
  },
  deployToLaunch: {
    label: 'Deploy to launch',
    reason: 'Calls DeployToLaunchWorkflow, which is not defined anywhere.',
    followUp: 'Implement the workflow and register it in the worker.',
  },
} as const satisfies Record<string, PreviewFeature>

export type PreviewFeatureKey = keyof typeof PREVIEW_FEATURES

export const PREVIEW_FEATURE_KEYS = Object.keys(PREVIEW_FEATURES) as PreviewFeatureKey[]

export const PREVIEW_FEATURES_ENV = 'ORBIT_ENABLE_PREVIEW_FEATURES'

/**
 * Raw env value. Property accesses must stay literal so Next can inline the
 * NEXT_PUBLIC_ variant into client bundles.
 */
export function readPreviewFeaturesEnv(): string | undefined {
  // Runtime server env wins when it is set at all (even empty); the
  // build-time NEXT_PUBLIC copy is the fallback, and the only value client
  // bundles can see.
  const runtime = process.env.ORBIT_ENABLE_PREVIEW_FEATURES
  if (runtime !== undefined) return runtime
  return process.env.NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES || undefined
}

function isKey(value: string): value is PreviewFeatureKey {
  return Object.prototype.hasOwnProperty.call(PREVIEW_FEATURES, value)
}

/**
 * Parse the env value into the set of enabled keys. Unknown keys are ignored.
 * Matching is case-insensitive; `all` enables every preview feature.
 */
export function parseEnabledFeatures(raw: string | undefined | null): Set<PreviewFeatureKey> {
  const enabled = new Set<PreviewFeatureKey>()
  if (!raw) return enabled

  const byLower = new Map(PREVIEW_FEATURE_KEYS.map((k) => [k.toLowerCase(), k]))
  for (const token of raw.split(',')) {
    const t = token.trim().toLowerCase()
    if (!t) continue
    if (t === 'all') {
      PREVIEW_FEATURE_KEYS.forEach((k) => enabled.add(k))
      continue
    }
    const key = byLower.get(t)
    if (key && isKey(key)) enabled.add(key)
  }
  return enabled
}

/** Whether a preview feature is enabled in the current server environment. */
export function isFeatureEnabled(
  key: PreviewFeatureKey,
  raw: string | undefined | null = readPreviewFeaturesEnv(),
): boolean {
  return parseEnabledFeatures(raw).has(key)
}

/** Call at the top of a server page/layout: 404s when the feature is hidden. */
export function assertFeatureEnabled(key: PreviewFeatureKey): void {
  if (!isFeatureEnabled(key)) notFound()
}

/** Error text returned by server actions that sit behind a hidden feature. */
export function featureUnavailableMessage(key: PreviewFeatureKey): string {
  return `${PREVIEW_FEATURES[key].label} is not available yet.`
}

/** A nav/tab/menu entry that may be tied to a preview feature. */
export interface FeatureGated {
  feature?: PreviewFeatureKey
}

/**
 * Drop entries whose feature is hidden. Entries without a `feature` are
 * always kept. Recurses into `items` children.
 */
export function filterByFeature<T extends FeatureGated & { items?: readonly FeatureGated[] }>(
  entries: readonly T[],
  enabled: ReadonlySet<PreviewFeatureKey> = parseEnabledFeatures(readPreviewFeaturesEnv()),
): T[] {
  return entries
    .filter((e) => !e.feature || enabled.has(e.feature))
    .map((e) => (e.items ? ({ ...e, items: filterByFeature(e.items, enabled) } as T) : e))
}
