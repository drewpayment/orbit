// storage-adapter-import-placeholder
import { mongooseAdapter } from '@payloadcms/db-mongodb';
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
import { PluginRegistry } from './collections/PluginRegistry'
import { PluginConfig } from './collections/PluginConfig'
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

// Kafka collections
import {
  KafkaProviders,
  KafkaClusters,
  KafkaEnvironmentMappings,
  KafkaApplications,
  KafkaVirtualClusters,
  KafkaTopics,
  KafkaSchemas,
  KafkaServiceAccounts,
  KafkaTopicShares,
  KafkaTopicSharePolicies,
  KafkaTopicPolicies,
  KafkaUsageMetrics,
  KafkaConsumerGroups,
  KafkaClientActivity,
  KafkaLineageEdge,
  KafkaLineageSnapshot,
} from './collections/kafka'

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
    PluginRegistry,
    PluginConfig,
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
    // Kafka collections
    KafkaProviders,
    KafkaClusters,
    KafkaEnvironmentMappings,
    KafkaApplications,
    KafkaVirtualClusters,
    KafkaTopics,
    KafkaSchemas,
    KafkaServiceAccounts,
    KafkaTopicShares,
    KafkaTopicSharePolicies,
    KafkaTopicPolicies,
    KafkaUsageMetrics,
    KafkaConsumerGroups,
    KafkaClientActivity,
    KafkaLineageEdge,
    KafkaLineageSnapshot,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    // storage-adapter-placeholder
  ],
})
