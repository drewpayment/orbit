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
    Workspaces,
    WorkspaceMembers,
    KnowledgeSpaces,
    KnowledgePages,
    PluginRegistry,
    PluginConfig,
    GitHubInstallations,
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
