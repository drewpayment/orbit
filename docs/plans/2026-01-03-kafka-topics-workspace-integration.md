# Kafka Topics Workspace Integration

## Overview

Add Kafka topics card to workspace detail view and implement the full topic creation flow, connecting the existing UI to actual Kafka cluster operations via franz-go.

## Goals

1. Display Kafka topics on workspace dashboard
2. Store topics in Payload CMS (consistent with clusters/providers/mappings)
3. Implement franz-go adapter methods for actual Kafka operations
4. Wire server actions to use Payload + Go gRPC service

## Design Decisions

- **Card placement:** Middle column, top position (infrastructure grouping with registries)
- **Card display:** Mini list showing 3-5 most recent topics with name/environment/status
- **Empty state:** Teaser with explanation + "Get Started" button
- **Storage:** Payload CMS collection (Go service handles Kafka operations only)
- **Sorting:** Most recent topics first

## Implementation

### 1. Payload Collection for Kafka Topics

**File:** `orbit-www/src/collections/kafka/KafkaTopics.ts`

```typescript
import type { CollectionConfig } from 'payload'

export const KafkaTopics: CollectionConfig = {
  slug: 'kafka-topics',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'environment', 'status'],
  },
  access: {
    read: ({ req: { user } }) => user?.collection === 'users',
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      validate: (value) => {
        if (!value) return 'Topic name is required'
        if (!/^[a-z0-9._-]+$/.test(value)) {
          return 'Topic name must be lowercase alphanumeric with dots, underscores, or hyphens'
        }
        return true
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'environment',
      type: 'select',
      required: true,
      options: [
        { label: 'Development', value: 'development' },
        { label: 'Staging', value: 'staging' },
        { label: 'Production', value: 'production' },
      ],
      defaultValue: 'development',
    },
    // Kafka configuration
    {
      name: 'partitions',
      type: 'number',
      required: true,
      defaultValue: 3,
      min: 1,
      max: 100,
    },
    {
      name: 'replicationFactor',
      type: 'number',
      required: true,
      defaultValue: 3,
      min: 1,
      max: 5,
    },
    {
      name: 'retentionMs',
      type: 'number',
      required: true,
      defaultValue: 604800000, // 7 days
    },
    {
      name: 'cleanupPolicy',
      type: 'select',
      options: [
        { label: 'Delete', value: 'delete' },
        { label: 'Compact', value: 'compact' },
        { label: 'Compact + Delete', value: 'compact_delete' },
      ],
      defaultValue: 'delete',
    },
    {
      name: 'compression',
      type: 'select',
      options: [
        { label: 'None', value: 'none' },
        { label: 'GZIP', value: 'gzip' },
        { label: 'Snappy', value: 'snappy' },
        { label: 'LZ4', value: 'lz4' },
        { label: 'ZSTD', value: 'zstd' },
      ],
      defaultValue: 'none',
    },
    {
      name: 'config',
      type: 'json',
      admin: {
        description: 'Additional Kafka topic configurations',
      },
    },
    // Status tracking
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Pending Approval', value: 'pending_approval' },
        { label: 'Provisioning', value: 'provisioning' },
        { label: 'Active', value: 'active' },
        { label: 'Failed', value: 'failed' },
        { label: 'Deleting', value: 'deleting' },
      ],
      defaultValue: 'pending_approval',
      index: true,
    },
    {
      name: 'clusterId',
      type: 'text',
      admin: {
        description: 'Cluster ID where topic was provisioned',
        position: 'sidebar',
      },
    },
    {
      name: 'fullTopicName',
      type: 'text',
      admin: {
        description: 'Full topic name on Kafka cluster (environment.workspace.name)',
        position: 'sidebar',
      },
    },
    {
      name: 'provisioningError',
      type: 'textarea',
      admin: {
        description: 'Error message if provisioning failed',
        condition: (data) => data?.status === 'failed',
      },
    },
    // Approval workflow
    {
      name: 'approvalRequired',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'approvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        condition: (data) => data?.approvalRequired,
      },
    },
    {
      name: 'approvedAt',
      type: 'date',
      admin: {
        condition: (data) => data?.approvalRequired,
      },
    },
    // Metadata
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
    },
  ],
  timestamps: true,
  indexes: [
    {
      name: 'workspace_name_unique',
      fields: ['workspace', 'name'],
      unique: true,
    },
  ],
}
```

### 2. Go Adapter Implementation

**File:** `services/kafka/internal/adapters/apache/client.go`

Implement these methods using franz-go:

```go
// Helper to create kgo client (extract from ValidateConnection)
func (c *Client) newKgoClient() (*kgo.Client, error) {
    opts := []kgo.Opt{
        kgo.SeedBrokers(c.config.BootstrapServers...),
        kgo.DialTimeout(10 * time.Second),
        kgo.RequestTimeoutOverhead(10 * time.Second),
    }
    // Add SASL/TLS opts based on config...
    return kgo.NewClient(opts...)
}

// CreateTopic creates a new topic on the Kafka cluster
func (c *Client) CreateTopic(ctx context.Context, spec adapters.TopicSpec) error {
    client, err := c.newKgoClient()
    if err != nil {
        return fmt.Errorf("failed to create kafka client: %w", err)
    }
    defer client.Close()

    admin := kadm.NewClient(client)
    configs := TopicSpecToConfig(spec)

    resp, err := admin.CreateTopics(ctx, int32(spec.Partitions), int16(spec.ReplicationFactor), configs, spec.Name)
    if err != nil {
        return fmt.Errorf("failed to create topic: %w", err)
    }

    // Check for topic-level errors
    for _, topic := range resp.Sorted() {
        if topic.Err != nil {
            return fmt.Errorf("failed to create topic %s: %w", topic.Topic, topic.Err)
        }
    }

    return nil
}

// DeleteTopic deletes a topic from the Kafka cluster
func (c *Client) DeleteTopic(ctx context.Context, topicName string) error {
    client, err := c.newKgoClient()
    if err != nil {
        return fmt.Errorf("failed to create kafka client: %w", err)
    }
    defer client.Close()

    admin := kadm.NewClient(client)
    resp, err := admin.DeleteTopics(ctx, topicName)
    if err != nil {
        return fmt.Errorf("failed to delete topic: %w", err)
    }

    for _, topic := range resp.Sorted() {
        if topic.Err != nil {
            return fmt.Errorf("failed to delete topic %s: %w", topic.Topic, topic.Err)
        }
    }

    return nil
}

// ListTopics lists all topics on the Kafka cluster
func (c *Client) ListTopics(ctx context.Context) ([]string, error) {
    client, err := c.newKgoClient()
    if err != nil {
        return nil, fmt.Errorf("failed to create kafka client: %w", err)
    }
    defer client.Close()

    admin := kadm.NewClient(client)
    topics, err := admin.ListTopics(ctx)
    if err != nil {
        return nil, fmt.Errorf("failed to list topics: %w", err)
    }

    names := make([]string, 0, len(topics))
    for _, t := range topics.Sorted() {
        names = append(names, t.Topic)
    }

    return names, nil
}
```

### 3. Server Actions

**File:** `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts`

Replace mock implementations with Payload CMS + gRPC calls:

```typescript
import { kafkaClient } from '@/lib/grpc/kafka-client'

export async function createTopic(input: CreateTopicInput): Promise<CreateTopicResult> {
  // 1. Validate workspace membership
  // 2. Create topic in Payload with status 'provisioning' (auto-approve for MVP)
  // 3. Get environment mapping to find cluster
  // 4. Call kafkaClient.createTopic() with full topic name
  // 5. Update Payload topic: status='active', clusterId, fullTopicName
  // 6. On error: status='failed', provisioningError
}

export async function listTopics(input: ListTopicsInput): Promise<ListTopicsResult> {
  // Query Payload: kafka-topics where workspace = input.workspaceId
  // Optional filters: environment, status
}

export async function deleteTopic(topicId: string): Promise<DeleteTopicResult> {
  // 1. Get topic from Payload
  // 2. Update status to 'deleting'
  // 3. Call kafkaClient.deleteTopic() if topic was provisioned
  // 4. Delete from Payload
}
```

### 4. Dashboard Card Component

**File:** `orbit-www/src/components/features/workspace/WorkspaceKafkaTopicsCard.tsx`

```typescript
interface WorkspaceKafkaTopicsCardProps {
  topics: Array<{
    id: string
    name: string
    environment: string
    status: string
  }>
  workspaceSlug: string
}

export function WorkspaceKafkaTopicsCard({ topics, workspaceSlug }: Props) {
  // Header: MessageSquare icon + "Kafka Topics" + orange "Create Topic" button
  // Empty state: Teaser text + "Get Started" button
  // List: Topic name, environment badge, status indicator
  // Footer: "View All" link to /workspaces/{slug}/kafka
}
```

### 5. Workspace Page Integration

**File:** `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx`

```typescript
// Add to data fetching:
const kafkaTopicsResult = await payload.find({
  collection: 'kafka-topics',
  where: { workspace: { equals: workspace.id } },
  sort: '-createdAt',
  limit: 5,
})

// Add to middle column (top):
<WorkspaceKafkaTopicsCard
  topics={kafkaTopicsResult.docs}
  workspaceSlug={workspace.slug}
/>
```

## Files to Modify

| File | Action |
|------|--------|
| `orbit-www/src/collections/kafka/KafkaTopics.ts` | Create |
| `orbit-www/src/payload.config.ts` | Add KafkaTopics to collections |
| `orbit-www/src/components/features/workspace/WorkspaceKafkaTopicsCard.tsx` | Create |
| `orbit-www/src/components/features/workspace/index.ts` | Export WorkspaceKafkaTopicsCard |
| `orbit-www/src/app/(frontend)/workspaces/[slug]/page.tsx` | Fetch topics, add card |
| `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts` | Replace mocks |
| `services/kafka/internal/adapters/apache/client.go` | Implement CreateTopic, DeleteTopic, ListTopics |

## Out of Scope

- Approval workflow UI (auto-approve for MVP)
- Schema management
- Topic sharing between workspaces
- Metrics and lineage
- ACL management

## Testing

1. Create topic via workspace UI → verify appears in Redpanda
2. Delete topic → verify removed from Redpanda
3. Dashboard card shows recent topics with correct status
4. Empty state displays when no topics exist
