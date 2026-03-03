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
