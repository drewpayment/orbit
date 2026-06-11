// storage-adapter-import-placeholder
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { resendAdapter } from '@payloadcms/email-resend'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Workspaces } from './collections/Workspaces'
import { WorkspaceMembers } from './collections/WorkspaceMembers'
import { KnowledgeSpaces } from './collections/KnowledgeSpaces'
import { KnowledgePages } from './collections/KnowledgePages'
import { GitHubInstallations } from './collections/GitHubInstallations'
import { Tenants } from './collections/Tenants'
import { PageLinks } from './collections/PageLinks'
import { Permissions } from './collections/Permissions'
import { Roles } from './collections/Roles'
import { UserWorkspaceRoles } from './collections/UserWorkspaceRoles'
import { Templates } from './collections/Templates'
import { Apps } from './collections/Apps'
import { Deployments } from './collections/Deployments'
import { DeploymentGenerators } from './collections/DeploymentGenerators'
import { HealthChecks } from './collections/HealthChecks'
import { RegistryConfigs } from './collections/RegistryConfigs'
import { EnvironmentVariables } from './collections/EnvironmentVariables'
import { RegistryImages } from './collections/RegistryImages'
import { Feedback } from './collections/Feedback'
import { CloudAccounts } from './collections/CloudAccounts'
import { LaunchTemplates } from './collections/LaunchTemplates'
import { Launches } from './collections/Launches'
import { LLMProviders } from './collections/LLMProviders'
import { AgentRuns } from './collections/AgentRuns'
import { AgentTools } from './collections/AgentTools'
import { AgentToolVersions } from './collections/AgentToolVersions'
import { Patterns } from './collections/Patterns'
import { PatternVersions } from './collections/PatternVersions'
import { PatternInstances } from './collections/PatternInstances'
import { PendingApprovals } from './collections/PendingApprovals'

// Kafka collections
import {
  KafkaProviders,
  KafkaClusters,
  KafkaEnvironmentMappings,
  BifrostConfig,
  KafkaApplications,
  KafkaVirtualClusters,
  KafkaTopics,
  KafkaSchemas,
  KafkaSchemaVersions,
  KafkaServiceAccounts,
  KafkaTopicShares,
  KafkaTopicSharePolicies,
  KafkaTopicPolicies,
  KafkaUsageMetrics,
  KafkaConsumerGroups,
  KafkaConsumerGroupLagHistory,
  KafkaClientActivity,
  KafkaApplicationQuotas,
  KafkaApplicationRequests,
  KafkaChargebackRates,
  KafkaLineageEdge,
  KafkaLineageSnapshot,
  KafkaOffsetCheckpoints,
} from './collections/kafka'

// API Catalog collections
import { APISchemas, APISchemaVersions } from './collections/api-catalog'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    Users,
    Media,
    Tenants,
    Workspaces,
    WorkspaceMembers,
    KnowledgeSpaces,
    KnowledgePages,
    PageLinks,
    GitHubInstallations,
    Permissions,
    Roles,
    UserWorkspaceRoles,
    Templates,
    Apps,
    Deployments,
    DeploymentGenerators,
    HealthChecks,
    RegistryConfigs,
    EnvironmentVariables,
    RegistryImages,
    Feedback,
    CloudAccounts,
    LaunchTemplates,
    Launches,
    // Infrastructure Agent
    LLMProviders,
    AgentRuns,
    AgentTools,
    AgentToolVersions,
    Patterns,
    PatternVersions,
    PatternInstances,
    PendingApprovals,
    // Kafka collections
    KafkaProviders,
    KafkaClusters,
    KafkaEnvironmentMappings,
    BifrostConfig,
    KafkaApplications,
    KafkaVirtualClusters,
    KafkaTopics,
    KafkaSchemas,
    KafkaSchemaVersions,
    KafkaServiceAccounts,
    KafkaTopicShares,
    KafkaTopicSharePolicies,
    KafkaTopicPolicies,
    KafkaUsageMetrics,
    KafkaConsumerGroups,
    KafkaConsumerGroupLagHistory,
    KafkaClientActivity,
    KafkaApplicationQuotas,
    KafkaApplicationRequests,
    KafkaChargebackRates,
    KafkaLineageEdge,
    KafkaLineageSnapshot,
    KafkaOffsetCheckpoints,
    // API Catalog collections
    APISchemas,
    APISchemaVersions,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DOCKER_BUILD ? false : (process.env.DATABASE_URI || ''),
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
  email: resendAdapter({
    defaultFromAddress: process.env.RESEND_FROM_EMAIL || 'noreply@orbit.dev',
    defaultFromName: 'Orbit',
    apiKey: process.env.RESEND_API_KEY || '',
  }),
})
