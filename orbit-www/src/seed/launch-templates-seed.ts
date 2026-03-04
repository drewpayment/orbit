/**
 * Launch Templates Seed Data
 *
 * Initial set of AWS launch templates (bundles + individual resources)
 * to populate the launch-templates collection.
 */

export const launchTemplatesSeedData = [
  // ─── Bundles ──────────────────────────────────────────────────────────
  {
    name: 'Web App Backend',
    slug: 'aws-web-app-backend',
    type: 'bundle' as const,
    provider: 'aws' as const,
    category: 'compute' as const,
    description:
      'Complete web application backend with VPC, ECS Fargate, Application Load Balancer, and RDS PostgreSQL database',
    pulumiProjectPath: 'bundles/web-app-backend',
    estimatedDuration: '~15 min',
    icon: 'server',
    builtIn: true,
    parameterSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', title: 'Application Name' },
        dbName: { type: 'string', title: 'Database Name', default: 'app' },
        dbInstanceClass: { type: 'string', title: 'DB Instance Class', default: 'db.t3.micro' },
        desiredCount: { type: 'number', title: 'Desired Task Count', default: 1 },
      },
      required: ['appName'],
    },
  },
  {
    name: 'Static Site',
    slug: 'aws-static-site',
    type: 'bundle' as const,
    provider: 'aws' as const,
    category: 'storage' as const,
    description: 'Static website hosting with S3 bucket and CloudFront CDN distribution',
    pulumiProjectPath: 'bundles/static-site',
    estimatedDuration: '~10 min',
    icon: 'globe',
    builtIn: true,
    parameterSchema: {
      type: 'object',
      properties: {
        siteName: { type: 'string', title: 'Site Name' },
        indexDocument: { type: 'string', title: 'Index Document', default: 'index.html' },
        errorDocument: { type: 'string', title: 'Error Document', default: 'error.html' },
      },
      required: ['siteName'],
    },
  },

  // ─── Individual Resources ─────────────────────────────────────────────
  {
    name: 'S3 Bucket',
    slug: 'aws-s3-bucket',
    type: 'resource' as const,
    provider: 'aws' as const,
    category: 'storage' as const,
    description: 'Amazon S3 bucket with configurable versioning and access controls',
    pulumiProjectPath: 'resources/s3-bucket',
    estimatedDuration: '~2 min',
    icon: 'database',
    builtIn: true,
    parameterSchema: {
      type: 'object',
      properties: {
        bucketName: { type: 'string', title: 'Bucket Name' },
        versioning: { type: 'boolean', title: 'Enable Versioning', default: false },
        publicAccess: { type: 'boolean', title: 'Allow Public Access', default: false },
      },
      required: ['bucketName'],
    },
  },
  {
    name: 'RDS PostgreSQL',
    slug: 'aws-rds-postgres',
    type: 'resource' as const,
    provider: 'aws' as const,
    category: 'database' as const,
    description: 'Amazon RDS PostgreSQL database instance',
    pulumiProjectPath: 'resources/rds-postgres',
    estimatedDuration: '~10 min',
    icon: 'database',
    builtIn: true,
    parameterSchema: {
      type: 'object',
      properties: {
        dbName: { type: 'string', title: 'Database Name' },
        instanceClass: { type: 'string', title: 'Instance Class', default: 'db.t3.micro' },
        storageGB: { type: 'number', title: 'Storage (GB)', default: 20 },
        masterUsername: { type: 'string', title: 'Master Username', default: 'postgres' },
      },
      required: ['dbName'],
    },
  },
  {
    name: 'ECS Fargate Cluster',
    slug: 'aws-ecs-fargate',
    type: 'resource' as const,
    provider: 'aws' as const,
    category: 'container' as const,
    description: 'Amazon ECS cluster with Fargate capacity provider',
    pulumiProjectPath: 'resources/ecs-cluster',
    estimatedDuration: '~5 min',
    icon: 'container',
    builtIn: true,
    parameterSchema: {
      type: 'object',
      properties: {
        clusterName: { type: 'string', title: 'Cluster Name' },
        enableContainerInsights: {
          type: 'boolean',
          title: 'Enable Container Insights',
          default: true,
        },
      },
      required: ['clusterName'],
    },
  },
  {
    name: 'VPC',
    slug: 'aws-vpc',
    type: 'resource' as const,
    provider: 'aws' as const,
    category: 'networking' as const,
    description:
      'Amazon VPC with public and private subnets across multiple availability zones',
    pulumiProjectPath: 'resources/vpc',
    estimatedDuration: '~5 min',
    icon: 'network',
    builtIn: true,
    parameterSchema: {
      type: 'object',
      properties: {
        vpcName: { type: 'string', title: 'VPC Name' },
        cidrBlock: { type: 'string', title: 'CIDR Block', default: '10.0.0.0/16' },
        azCount: { type: 'number', title: 'Availability Zone Count', default: 2 },
      },
      required: ['vpcName'],
    },
  },

  // --- GCP Individual Resources ---
  {
    name: 'GCS Bucket',
    slug: 'gcp-gcs-bucket',
    description: 'Provision a Google Cloud Storage bucket with configurable versioning, lifecycle policies, and access controls.',
    type: 'resource' as const,
    provider: 'gcp' as const,
    category: 'storage' as const,
    pulumiProjectPath: 'resources/gcs-bucket',
    estimatedDuration: '~2 min',
    parameterSchema: {
      type: 'object',
      properties: {
        bucketName: { type: 'string', title: 'Bucket Name', description: 'Globally unique name for the GCS bucket' },
        location: { type: 'string', title: 'Location', default: 'US', description: 'Multi-region or region for bucket storage' },
        versioning: { type: 'boolean', title: 'Enable Versioning', default: false },
        publicAccess: { type: 'boolean', title: 'Allow Public Access', default: false },
      },
      required: ['bucketName'],
    },
  },
  {
    name: 'Cloud SQL PostgreSQL',
    slug: 'gcp-cloud-sql-postgresql',
    description: 'Provision a Cloud SQL PostgreSQL instance with automated backups, a database, and user credentials.',
    type: 'resource' as const,
    provider: 'gcp' as const,
    category: 'database' as const,
    pulumiProjectPath: 'resources/cloud-sql-postgresql',
    estimatedDuration: '~10 min',
    parameterSchema: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', title: 'Instance Name', description: 'Cloud SQL instance name' },
        databaseVersion: { type: 'string', title: 'PostgreSQL Version', default: 'POSTGRES_15', enum: ['POSTGRES_15', 'POSTGRES_14', 'POSTGRES_13'] },
        tier: { type: 'string', title: 'Machine Type', default: 'db-f1-micro', enum: ['db-f1-micro', 'db-g1-small', 'db-custom-2-7680'] },
        databaseName: { type: 'string', title: 'Database Name', default: 'orbit' },
        databaseUser: { type: 'string', title: 'Database User', default: 'orbit' },
      },
    },
  },
  {
    name: 'Cloud Run Service',
    slug: 'gcp-cloud-run-service',
    description: 'Deploy a containerized application to Cloud Run with auto-scaling, custom resource limits, and IAM configuration.',
    type: 'resource' as const,
    provider: 'gcp' as const,
    category: 'container' as const,
    pulumiProjectPath: 'resources/cloud-run-service',
    estimatedDuration: '~3 min',
    parameterSchema: {
      type: 'object',
      properties: {
        serviceName: { type: 'string', title: 'Service Name', description: 'Cloud Run service name' },
        containerImage: { type: 'string', title: 'Container Image', description: 'Container image URL (e.g., us-docker.pkg.dev/project/repo/image:tag)' },
        containerPort: { type: 'number', title: 'Container Port', default: 8080 },
        cpu: { type: 'string', title: 'CPU', default: '1', enum: ['1', '2', '4'] },
        memory: { type: 'string', title: 'Memory', default: '512Mi', enum: ['256Mi', '512Mi', '1Gi', '2Gi', '4Gi'] },
        maxInstances: { type: 'number', title: 'Max Instances', default: 10 },
        allowUnauthenticated: { type: 'boolean', title: 'Allow Unauthenticated Access', default: false },
      },
      required: ['containerImage'],
    },
  },
  {
    name: 'VPC Network',
    slug: 'gcp-vpc-network',
    description: 'Create a VPC network with custom subnet, Cloud NAT, Cloud Router, and firewall rules for internal traffic and IAP SSH access.',
    type: 'resource' as const,
    provider: 'gcp' as const,
    category: 'networking' as const,
    pulumiProjectPath: 'resources/vpc-network',
    estimatedDuration: '~3 min',
    parameterSchema: {
      type: 'object',
      properties: {
        networkName: { type: 'string', title: 'Network Name', description: 'Name for the VPC network' },
        subnetCidr: { type: 'string', title: 'Subnet CIDR', default: '10.0.0.0/24', description: 'IP range for the primary subnet' },
        enableNat: { type: 'boolean', title: 'Enable Cloud NAT', default: true },
      },
    },
  },
  // --- GCP Bundles ---
  {
    name: 'Web App Backend',
    slug: 'gcp-web-app-backend',
    description: 'Full backend stack: VPC network, Cloud Run service, Cloud SQL PostgreSQL, Cloud Load Balancing, and IAM — everything needed for a production GCP web backend.',
    type: 'bundle' as const,
    provider: 'gcp' as const,
    category: 'compute' as const,
    pulumiProjectPath: 'bundles/web-app-backend',
    estimatedDuration: '~15 min',
    parameterSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', title: 'Application Name', description: 'Name prefix for all resources' },
        containerImage: { type: 'string', title: 'Container Image', description: 'Container image for Cloud Run' },
        dbTier: { type: 'string', title: 'Database Tier', default: 'db-f1-micro', enum: ['db-f1-micro', 'db-g1-small', 'db-custom-2-7680'] },
      },
      required: ['appName', 'containerImage'],
    },
  },
  {
    name: 'Static Site',
    slug: 'gcp-static-site',
    description: 'Host a static website with GCS bucket, Cloud CDN, SSL certificate, and DNS — optimized for global content delivery.',
    type: 'bundle' as const,
    provider: 'gcp' as const,
    category: 'storage' as const,
    pulumiProjectPath: 'bundles/static-site',
    estimatedDuration: '~8 min',
    parameterSchema: {
      type: 'object',
      properties: {
        siteName: { type: 'string', title: 'Site Name', description: 'Name prefix for all resources' },
        domainName: { type: 'string', title: 'Domain Name', description: 'Custom domain (e.g., www.example.com)' },
        enableCdn: { type: 'boolean', title: 'Enable Cloud CDN', default: true },
      },
      required: ['siteName'],
    },
  },

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
