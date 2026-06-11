/**
 * Launch Templates Seed Data
 *
 * Initial set of Azure launch templates
 * to populate the launch-templates collection.
 */

export const launchTemplatesSeedData = [
  // --- Azure Individual Resources ---
  {
    name: 'Blob Storage',
    slug: 'azure-blob-storage',
    description: 'Provision an Azure Storage Account with a Blob Container, configurable versioning, and access controls.',
    type: 'resource' as const,
    provider: 'azure' as const,
    category: 'storage' as const,
    pulumiProjectPath: 'resources/blob-storage',
    estimatedDuration: '~2 min',
    parameterSchema: {
      type: 'object',
      properties: {
        resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
        storageAccountName: { type: 'string', title: 'Storage Account Name', description: 'Globally unique, lowercase, 3-24 chars' },
        containerName: { type: 'string', title: 'Container Name', default: 'default' },
        enableVersioning: { type: 'boolean', title: 'Enable Versioning', default: false },
        publicAccess: { type: 'boolean', title: 'Allow Public Access', default: false },
      },
      required: ['resourceGroupName', 'storageAccountName'],
    },
  },
  {
    name: 'PostgreSQL Flexible Server',
    slug: 'azure-postgresql-flexible',
    description: 'Provision an Azure Database for PostgreSQL Flexible Server with automated backups, a database, and admin credentials.',
    type: 'resource' as const,
    provider: 'azure' as const,
    category: 'database' as const,
    pulumiProjectPath: 'resources/postgresql-flexible',
    estimatedDuration: '~10 min',
    parameterSchema: {
      type: 'object',
      properties: {
        resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
        serverName: { type: 'string', title: 'Server Name', description: 'PostgreSQL server name' },
        postgresVersion: { type: 'string', title: 'PostgreSQL Version', default: '16', enum: ['16', '15', '14'] },
        skuName: { type: 'string', title: 'SKU Name', default: 'Standard_B1ms', enum: ['Standard_B1ms', 'Standard_B2s', 'Standard_D4ds_v5'] },
        skuTier: { type: 'string', title: 'SKU Tier', default: 'Burstable', enum: ['Burstable', 'GeneralPurpose', 'MemoryOptimized'] },
        storageSizeGB: { type: 'number', title: 'Storage (GB)', default: 32 },
        databaseName: { type: 'string', title: 'Database Name', default: 'orbit' },
        adminUser: { type: 'string', title: 'Admin User', default: 'orbitadmin' },
      },
      required: ['resourceGroupName'],
    },
  },
  {
    name: 'Container App',
    slug: 'azure-container-app',
    description: 'Deploy a containerized application to Azure Container Apps with auto-scaling, managed environment, and ingress configuration.',
    type: 'resource' as const,
    provider: 'azure' as const,
    category: 'container' as const,
    pulumiProjectPath: 'resources/container-app',
    estimatedDuration: '~3 min',
    parameterSchema: {
      type: 'object',
      properties: {
        resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
        appName: { type: 'string', title: 'App Name', description: 'Container app name' },
        containerImage: { type: 'string', title: 'Container Image', description: 'Container image URL' },
        containerPort: { type: 'number', title: 'Container Port', default: 80 },
        cpu: { type: 'number', title: 'CPU (cores)', default: 0.5, enum: [0.25, 0.5, 1, 2, 4] },
        memory: { type: 'string', title: 'Memory', default: '1Gi', enum: ['0.5Gi', '1Gi', '2Gi', '4Gi'] },
        maxReplicas: { type: 'number', title: 'Max Replicas', default: 10 },
        minReplicas: { type: 'number', title: 'Min Replicas', default: 1 },
        externalIngress: { type: 'boolean', title: 'External Ingress', default: true },
      },
      required: ['resourceGroupName', 'containerImage'],
    },
  },
  {
    name: 'Virtual Network',
    slug: 'azure-vnet',
    description: 'Create an Azure Virtual Network with subnet, Network Security Group, and configurable address space.',
    type: 'resource' as const,
    provider: 'azure' as const,
    category: 'networking' as const,
    pulumiProjectPath: 'resources/vnet',
    estimatedDuration: '~2 min',
    parameterSchema: {
      type: 'object',
      properties: {
        resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
        vnetName: { type: 'string', title: 'VNet Name', description: 'Name for the virtual network' },
        addressPrefix: { type: 'string', title: 'Address Space', default: '10.0.0.0/16' },
        subnetPrefix: { type: 'string', title: 'Subnet CIDR', default: '10.0.1.0/24' },
      },
      required: ['resourceGroupName'],
    },
  },
  // --- Azure Bundles ---
  {
    name: 'Web App Backend',
    slug: 'azure-web-app-backend',
    description: 'Full backend stack: VNet, Container App, PostgreSQL Flexible Server, Application Gateway, and managed identities — everything needed for a production Azure web backend.',
    type: 'bundle' as const,
    provider: 'azure' as const,
    category: 'compute' as const,
    pulumiProjectPath: 'bundles/web-app-backend',
    estimatedDuration: '~15 min',
    parameterSchema: {
      type: 'object',
      properties: {
        resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
        appName: { type: 'string', title: 'Application Name', description: 'Name prefix for all resources' },
        containerImage: { type: 'string', title: 'Container Image', description: 'Container image for the app' },
        dbSkuName: { type: 'string', title: 'Database SKU', default: 'Standard_B1ms', enum: ['Standard_B1ms', 'Standard_B2s', 'Standard_D4ds_v5'] },
      },
      required: ['resourceGroupName', 'appName', 'containerImage'],
    },
  },
  {
    name: 'Static Site',
    slug: 'azure-static-site',
    description: 'Host a static website with Azure Storage static website hosting, CDN profile, and custom domain — optimized for global content delivery.',
    type: 'bundle' as const,
    provider: 'azure' as const,
    category: 'storage' as const,
    pulumiProjectPath: 'bundles/static-site',
    estimatedDuration: '~5 min',
    parameterSchema: {
      type: 'object',
      properties: {
        resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
        siteName: { type: 'string', title: 'Site Name', description: 'Name prefix for all resources' },
        domainName: { type: 'string', title: 'Domain Name', description: 'Custom domain (e.g., www.example.com)' },
        enableCdn: { type: 'boolean', title: 'Enable CDN', default: true },
      },
      required: ['resourceGroupName', 'siteName'],
    },
  },
]

/**
 * Seed function to populate the launch-templates collection.
 * Idempotent: skips templates that already exist (matched by slug).
 */
export async function seedLaunchTemplates(payload: any) {
  console.log('Seeding launch templates...')

  let created = 0
  let skipped = 0

  for (const templateData of launchTemplatesSeedData) {
    try {
      const existing = await payload.find({
        collection: 'launch-templates',
        where: {
          slug: {
            equals: templateData.slug,
          },
        },
      })

      if (existing.docs.length > 0) {
        console.log(`  Template "${templateData.name}" already exists, skipping.`)
        skipped++
      } else {
        console.log(`  Creating template "${templateData.name}"...`)
        await payload.create({
          collection: 'launch-templates',
          data: templateData,
        })
        created++
      }
    } catch (error) {
      console.error(`  Error seeding template "${templateData.name}":`, error)
    }
  }

  console.log(`Launch template seeding complete! Created: ${created}, Skipped: ${skipped}`)
}
