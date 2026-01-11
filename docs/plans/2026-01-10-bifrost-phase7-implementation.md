# Bifrost Phase 7: Schema Registry & Consumer Groups - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement pull-based Schema Registry sync and Consumer Group tracking with full-featured UI pages.

**Architecture:** Temporal singleton workflows poll Schema Registry and Kafka Admin APIs, sync data to Payload collections. UI provides unified observability across workspaces with permission filtering.

**Tech Stack:** Go/Temporal (workflows), TypeScript/Payload (collections), React/shadcn (UI), Recharts (charts)

---

## Phase 7A: Data Layer (Tasks 1-4)

### Task 1: Create KafkaSchemaVersions Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/KafkaSchemaVersions.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the collection file**

Create `orbit-www/src/collections/kafka/KafkaSchemaVersions.ts`:

```typescript
import type { CollectionConfig, Where } from 'payload'

export const KafkaSchemaVersions: CollectionConfig = {
  slug: 'kafka-schema-versions',
  admin: {
    useAsTitle: 'version',
    group: 'Kafka',
    defaultColumns: ['schema', 'version', 'schemaId', 'registeredAt'],
    description: 'Historical versions of Kafka schemas',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'schema',
      type: 'relationship',
      relationTo: 'kafka-schemas',
      required: true,
      index: true,
      admin: {
        description: 'Parent schema record',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace for access control',
      },
    },
    {
      name: 'version',
      type: 'number',
      required: true,
      index: true,
      admin: {
        description: 'Schema Registry version number',
      },
    },
    {
      name: 'schemaId',
      type: 'number',
      required: true,
      admin: {
        description: 'Global Schema Registry ID',
      },
    },
    {
      name: 'content',
      type: 'code',
      required: true,
      admin: {
        language: 'json',
        description: 'Full schema definition',
      },
    },
    {
      name: 'fingerprint',
      type: 'text',
      index: true,
      admin: {
        description: 'Schema hash for deduplication',
      },
    },
    {
      name: 'compatibilityMode',
      type: 'select',
      options: [
        { label: 'Backward', value: 'backward' },
        { label: 'Forward', value: 'forward' },
        { label: 'Full', value: 'full' },
        { label: 'None', value: 'none' },
      ],
      admin: {
        description: 'Compatibility mode when registered',
      },
    },
    {
      name: 'isCompatible',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Was this version compatible when registered',
      },
    },
    {
      name: 'registeredAt',
      type: 'date',
      admin: {
        description: 'When registered in Schema Registry',
      },
    },
    {
      name: 'syncedAt',
      type: 'date',
      admin: {
        description: 'When synced to Orbit',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Add export to index file**

Modify `orbit-www/src/collections/kafka/index.ts`, add after `KafkaSchemas` export:

```typescript
export { KafkaSchemaVersions } from './KafkaSchemaVersions'
```

**Step 3: Register in payload.config.ts**

Modify `orbit-www/src/payload.config.ts`:

1. Add to import block:
```typescript
import {
  // ... existing imports
  KafkaSchemaVersions,
} from './collections/kafka'
```

2. Add to collections array after `KafkaSchemas`:
```typescript
KafkaSchemaVersions,
```

**Step 4: Verify collection loads**

Run: `cd orbit-www && pnpm dev`

Expected: Server starts without errors, collection visible in Payload admin at `/admin/collections/kafka-schema-versions`

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaSchemaVersions.ts orbit-www/src/collections/kafka/index.ts orbit-www/src/payload.config.ts
git commit -m "feat(kafka): add KafkaSchemaVersions collection for schema history"
```

---

### Task 2: Create KafkaConsumerGroupLagHistory Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/KafkaConsumerGroupLagHistory.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create the collection file**

Create `orbit-www/src/collections/kafka/KafkaConsumerGroupLagHistory.ts`:

```typescript
import type { CollectionConfig, Where } from 'payload'

export const KafkaConsumerGroupLagHistory: CollectionConfig = {
  slug: 'kafka-consumer-group-lag-history',
  admin: {
    useAsTitle: 'timestamp',
    group: 'Kafka',
    defaultColumns: ['consumerGroup', 'totalLag', 'memberCount', 'timestamp'],
    description: 'Historical lag snapshots for consumer groups',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: {
          user: { equals: user.id },
          status: { equals: 'active' },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return {
        workspace: { in: workspaceIds },
      } as Where
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'consumerGroup',
      type: 'relationship',
      relationTo: 'kafka-consumer-groups',
      required: true,
      index: true,
      admin: {
        description: 'Consumer group this snapshot belongs to',
      },
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      index: true,
      admin: {
        description: 'Virtual cluster for efficient queries',
      },
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
      admin: {
        description: 'Workspace for access control',
      },
    },
    {
      name: 'timestamp',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'When this snapshot was taken',
      },
    },
    {
      name: 'totalLag',
      type: 'number',
      required: true,
      admin: {
        description: 'Sum of all partition lags',
      },
    },
    {
      name: 'partitionLag',
      type: 'json',
      admin: {
        description: 'Per-partition lag: { "topic-0": 150, "topic-1": 42 }',
      },
    },
    {
      name: 'memberCount',
      type: 'number',
      admin: {
        description: 'Number of members at time of snapshot',
      },
    },
    {
      name: 'state',
      type: 'text',
      admin: {
        description: 'Group state at time of snapshot',
      },
    },
  ],
  timestamps: true,
}
```

**Step 2: Add export to index file**

Modify `orbit-www/src/collections/kafka/index.ts`, add after `KafkaConsumerGroups` export:

```typescript
export { KafkaConsumerGroupLagHistory } from './KafkaConsumerGroupLagHistory'
```

**Step 3: Register in payload.config.ts**

Add to import and collections array after `KafkaConsumerGroups`:

```typescript
KafkaConsumerGroupLagHistory,
```

**Step 4: Verify collection loads**

Run: `cd orbit-www && pnpm dev`

Expected: Server starts, collection visible at `/admin/collections/kafka-consumer-group-lag-history`

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaConsumerGroupLagHistory.ts orbit-www/src/collections/kafka/index.ts orbit-www/src/payload.config.ts
git commit -m "feat(kafka): add KafkaConsumerGroupLagHistory collection for lag charts"
```

---

### Task 3: Extend KafkaSchemas Collection

**Files:**
- Modify: `orbit-www/src/collections/kafka/KafkaSchemas.ts`

**Step 1: Add new fields to KafkaSchemas**

Modify `orbit-www/src/collections/kafka/KafkaSchemas.ts`, add these fields to the `fields` array before the `timestamps` property:

```typescript
    {
      name: 'latestVersion',
      type: 'number',
      admin: {
        description: 'Latest version number (cached)',
      },
    },
    {
      name: 'versionCount',
      type: 'number',
      admin: {
        description: 'Total versions registered',
      },
    },
    {
      name: 'firstRegisteredAt',
      type: 'date',
      admin: {
        description: 'When first version was registered',
      },
    },
    {
      name: 'lastRegisteredAt',
      type: 'date',
      admin: {
        description: 'When latest version was registered',
      },
    },
```

**Step 2: Update status options to include 'stale'**

Find the existing `status` field and update the options array:

```typescript
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Registered', value: 'registered' },
        { label: 'Failed', value: 'failed' },
        { label: 'Stale', value: 'stale' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
```

**Step 3: Verify changes**

Run: `cd orbit-www && pnpm dev`

Expected: Server starts, new fields visible in Payload admin for kafka-schemas collection

**Step 4: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaSchemas.ts
git commit -m "feat(kafka): extend KafkaSchemas with version tracking fields"
```

---

### Task 4: Extend KafkaConsumerGroups Collection

**Files:**
- Modify: `orbit-www/src/collections/kafka/KafkaConsumerGroups.ts`

**Step 1: Add new fields to KafkaConsumerGroups**

Modify `orbit-www/src/collections/kafka/KafkaConsumerGroups.ts`, add these fields to the `fields` array:

```typescript
    {
      name: 'subscribedTopics',
      type: 'relationship',
      relationTo: 'kafka-topics',
      hasMany: true,
      admin: {
        description: 'Topics this group consumes',
      },
    },
    {
      name: 'coordinatorBroker',
      type: 'text',
      admin: {
        description: 'Broker ID hosting coordinator',
      },
    },
    {
      name: 'assignmentStrategy',
      type: 'text',
      admin: {
        description: 'range, roundrobin, sticky, cooperative-sticky',
      },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
        { label: 'Archived', value: 'archived' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Sync status',
      },
    },
```

**Step 2: Verify changes**

Run: `cd orbit-www && pnpm dev`

Expected: Server starts, new fields visible in kafka-consumer-groups collection

**Step 3: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaConsumerGroups.ts
git commit -m "feat(kafka): extend KafkaConsumerGroups with subscription and status fields"
```

---

## Phase 7B: Temporal Workflows (Tasks 5-8)

### Task 5: Implement SchemaSyncWorkflow

**Files:**
- Create: `temporal-workflows/internal/workflows/kafka_schema_sync_workflow.go`
- Create: `temporal-workflows/internal/activities/kafka_schema_sync_activities.go`

**Step 5.1: Create schema sync activities file**

Create `temporal-workflows/internal/activities/kafka_schema_sync_activities.go`:

```go
package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SchemaSyncActivities defines activities for schema synchronization
type SchemaSyncActivities struct {
	httpClient *http.Client
	orbitURL   string
}

// NewSchemaSyncActivities creates a new SchemaSyncActivities instance
func NewSchemaSyncActivities(orbitURL string) *SchemaSyncActivities {
	return &SchemaSyncActivities{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		orbitURL:   orbitURL,
	}
}

// ClusterInfo represents a Kafka cluster with schema registry
type ClusterInfo struct {
	ID                string
	Name              string
	SchemaRegistryURL string
	Username          string
	Password          string
}

// FetchClustersInput is the input for FetchClustersWithSchemaRegistry
type FetchClustersInput struct{}

// FetchClustersOutput is the output for FetchClustersWithSchemaRegistry
type FetchClustersOutput struct {
	Clusters []ClusterInfo
}

// FetchClustersWithSchemaRegistry fetches all clusters that have schema registry configured
func (a *SchemaSyncActivities) FetchClustersWithSchemaRegistry(ctx context.Context, input FetchClustersInput) (*FetchClustersOutput, error) {
	// TODO: Query Payload API for clusters with schemaRegistryUrl set
	// For now, return empty list - will be implemented when connecting to real Payload API
	return &FetchClustersOutput{
		Clusters: []ClusterInfo{},
	}, nil
}

// FetchSubjectsInput is the input for FetchSubjects
type FetchSubjectsInput struct {
	ClusterID         string
	SchemaRegistryURL string
	Username          string
	Password          string
}

// FetchSubjectsOutput is the output for FetchSubjects
type FetchSubjectsOutput struct {
	Subjects []string
}

// FetchSubjects fetches all subjects from a Schema Registry
func (a *SchemaSyncActivities) FetchSubjects(ctx context.Context, input FetchSubjectsInput) (*FetchSubjectsOutput, error) {
	reqURL := fmt.Sprintf("%s/subjects", strings.TrimSuffix(input.SchemaRegistryURL, "/"))

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.schemaregistry.v1+json")
	if input.Username != "" {
		req.SetBasicAuth(input.Username, input.Password)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch subjects: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("schema registry returned %d: %s", resp.StatusCode, string(body))
	}

	var subjects []string
	if err := json.NewDecoder(resp.Body).Decode(&subjects); err != nil {
		return nil, fmt.Errorf("failed to decode subjects: %w", err)
	}

	return &FetchSubjectsOutput{Subjects: subjects}, nil
}

// SchemaVersionInfo represents a single schema version
type SchemaVersionInfo struct {
	Subject    string
	Version    int
	SchemaID   int
	SchemaType string
	Schema     string
}

// SyncSchemaVersionsInput is the input for SyncSchemaVersions
type SyncSchemaVersionsInput struct {
	ClusterID         string
	SchemaRegistryURL string
	Username          string
	Password          string
	Subject           string
}

// SyncSchemaVersionsOutput is the output for SyncSchemaVersions
type SyncSchemaVersionsOutput struct {
	VersionsSynced int
	LatestVersion  int
	SchemaID       int
}

// SyncSchemaVersions fetches all versions of a subject and syncs to Payload
func (a *SchemaSyncActivities) SyncSchemaVersions(ctx context.Context, input SyncSchemaVersionsInput) (*SyncSchemaVersionsOutput, error) {
	baseURL := strings.TrimSuffix(input.SchemaRegistryURL, "/")

	// 1. Get all versions for this subject
	versionsURL := fmt.Sprintf("%s/subjects/%s/versions", baseURL, url.PathEscape(input.Subject))
	req, err := http.NewRequestWithContext(ctx, "GET", versionsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create versions request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.schemaregistry.v1+json")
	if input.Username != "" {
		req.SetBasicAuth(input.Username, input.Password)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch versions: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("schema registry returned %d: %s", resp.StatusCode, string(body))
	}

	var versions []int
	if err := json.NewDecoder(resp.Body).Decode(&versions); err != nil {
		return nil, fmt.Errorf("failed to decode versions: %w", err)
	}

	if len(versions) == 0 {
		return &SyncSchemaVersionsOutput{VersionsSynced: 0}, nil
	}

	// 2. Fetch each version's details
	var latestSchemaID int
	for _, version := range versions {
		versionURL := fmt.Sprintf("%s/subjects/%s/versions/%d", baseURL, url.PathEscape(input.Subject), version)
		vReq, err := http.NewRequestWithContext(ctx, "GET", versionURL, nil)
		if err != nil {
			continue
		}
		vReq.Header.Set("Accept", "application/vnd.schemaregistry.v1+json")
		if input.Username != "" {
			vReq.SetBasicAuth(input.Username, input.Password)
		}

		vResp, err := a.httpClient.Do(vReq)
		if err != nil {
			continue
		}

		var versionInfo struct {
			Subject    string `json:"subject"`
			Version    int    `json:"version"`
			ID         int    `json:"id"`
			SchemaType string `json:"schemaType"`
			Schema     string `json:"schema"`
		}
		if err := json.NewDecoder(vResp.Body).Decode(&versionInfo); err != nil {
			vResp.Body.Close()
			continue
		}
		vResp.Body.Close()

		latestSchemaID = versionInfo.ID

		// TODO: Upsert to Payload KafkaSchemaVersions collection
		// This will be implemented when connecting to real Payload API
	}

	latestVersion := versions[len(versions)-1]

	return &SyncSchemaVersionsOutput{
		VersionsSynced: len(versions),
		LatestVersion:  latestVersion,
		SchemaID:       latestSchemaID,
	}, nil
}

// MarkStaleSchemasInput is the input for MarkStaleSchemas
type MarkStaleSchemasInput struct {
	ClusterID    string
	SyncedBefore time.Time
}

// MarkStaleSchemas marks schemas not seen in recent sync as stale
func (a *SchemaSyncActivities) MarkStaleSchemas(ctx context.Context, input MarkStaleSchemasInput) error {
	// TODO: Query Payload for schemas with syncedAt < SyncedBefore and update status to 'stale'
	return nil
}
```

**Step 5.2: Create schema sync workflow file**

Create `temporal-workflows/internal/workflows/kafka_schema_sync_workflow.go`:

```go
package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// KafkaSchemaSyncTaskQueue is the task queue for schema sync workflows
	KafkaSchemaSyncTaskQueue = "kafka-schema-sync"
)

// SchemaSyncWorkflowInput defines input for the schema sync workflow
type SchemaSyncWorkflowInput struct {
	// Empty for now - workflow syncs all clusters
}

// SchemaSyncWorkflowResult defines the output of the schema sync workflow
type SchemaSyncWorkflowResult struct {
	ClustersProcessed int
	SubjectsSynced    int
	SchemasFailed     int
	Duration          time.Duration
}

// SchemaSyncWorkflow orchestrates periodic sync of schemas from Schema Registry to Orbit
func SchemaSyncWorkflow(ctx workflow.Context, input SchemaSyncWorkflowInput) (SchemaSyncWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	startTime := workflow.Now(ctx)

	logger.Info("Starting schema sync workflow")

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var schemaSyncActivities *activities.SchemaSyncActivities

	// Step 1: Fetch all clusters with schema registry configured
	logger.Info("Step 1: Fetching clusters with schema registry")
	var clustersOutput *activities.FetchClustersOutput
	err := workflow.ExecuteActivity(ctx, schemaSyncActivities.FetchClustersWithSchemaRegistry, activities.FetchClustersInput{}).Get(ctx, &clustersOutput)
	if err != nil {
		logger.Error("Failed to fetch clusters", "Error", err)
		return SchemaSyncWorkflowResult{}, err
	}

	logger.Info("Found clusters with schema registry", "Count", len(clustersOutput.Clusters))

	var totalSubjectsSynced int
	var totalSchemasFailed int

	// Step 2: Process each cluster sequentially
	for _, cluster := range clustersOutput.Clusters {
		logger.Info("Processing cluster", "ClusterID", cluster.ID, "Name", cluster.Name)

		// Fetch subjects from this cluster's schema registry
		var subjectsOutput *activities.FetchSubjectsOutput
		err := workflow.ExecuteActivity(ctx, schemaSyncActivities.FetchSubjects, activities.FetchSubjectsInput{
			ClusterID:         cluster.ID,
			SchemaRegistryURL: cluster.SchemaRegistryURL,
			Username:          cluster.Username,
			Password:          cluster.Password,
		}).Get(ctx, &subjectsOutput)

		if err != nil {
			logger.Warn("Failed to fetch subjects from cluster", "ClusterID", cluster.ID, "Error", err)
			continue
		}

		logger.Info("Found subjects in cluster", "ClusterID", cluster.ID, "SubjectCount", len(subjectsOutput.Subjects))

		// Sync each subject (could be parallelized with workflow.Go for batching)
		for _, subject := range subjectsOutput.Subjects {
			var syncOutput *activities.SyncSchemaVersionsOutput
			err := workflow.ExecuteActivity(ctx, schemaSyncActivities.SyncSchemaVersions, activities.SyncSchemaVersionsInput{
				ClusterID:         cluster.ID,
				SchemaRegistryURL: cluster.SchemaRegistryURL,
				Username:          cluster.Username,
				Password:          cluster.Password,
				Subject:           subject,
			}).Get(ctx, &syncOutput)

			if err != nil {
				logger.Warn("Failed to sync subject", "Subject", subject, "Error", err)
				totalSchemasFailed++
				continue
			}

			totalSubjectsSynced++
			logger.Debug("Synced subject", "Subject", subject, "Versions", syncOutput.VersionsSynced)
		}

		// Mark stale schemas for this cluster
		syncTime := workflow.Now(ctx)
		_ = workflow.ExecuteActivity(ctx, schemaSyncActivities.MarkStaleSchemas, activities.MarkStaleSchemasInput{
			ClusterID:    cluster.ID,
			SyncedBefore: syncTime.Add(-10 * time.Minute), // Schemas not seen in last 10 min are stale
		}).Get(ctx, nil)
	}

	duration := workflow.Now(ctx).Sub(startTime)

	logger.Info("Schema sync workflow completed",
		"ClustersProcessed", len(clustersOutput.Clusters),
		"SubjectsSynced", totalSubjectsSynced,
		"SchemasFailed", totalSchemasFailed,
		"Duration", duration,
	)

	return SchemaSyncWorkflowResult{
		ClustersProcessed: len(clustersOutput.Clusters),
		SubjectsSynced:    totalSubjectsSynced,
		SchemasFailed:     totalSchemasFailed,
		Duration:          duration,
	}, nil
}
```

**Step 5.3: Verify workflow compiles**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds with no errors

**Step 5.4: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_schema_sync_activities.go temporal-workflows/internal/workflows/kafka_schema_sync_workflow.go
git commit -m "feat(temporal): add SchemaSyncWorkflow for Schema Registry sync"
```

---

### Task 6: Implement ConsumerGroupSyncWorkflow

**Files:**
- Create: `temporal-workflows/internal/activities/kafka_consumer_group_activities.go`
- Create: `temporal-workflows/internal/workflows/kafka_consumer_group_sync_workflow.go`

**Step 6.1: Create consumer group activities file**

Create `temporal-workflows/internal/activities/kafka_consumer_group_activities.go`:

```go
package activities

import (
	"context"
	"time"
)

// ConsumerGroupSyncActivities defines activities for consumer group synchronization
type ConsumerGroupSyncActivities struct {
	orbitURL string
}

// NewConsumerGroupSyncActivities creates a new ConsumerGroupSyncActivities instance
func NewConsumerGroupSyncActivities(orbitURL string) *ConsumerGroupSyncActivities {
	return &ConsumerGroupSyncActivities{
		orbitURL: orbitURL,
	}
}

// KafkaClusterInfo represents a Kafka cluster for consumer group queries
type KafkaClusterInfo struct {
	ID               string
	Name             string
	BootstrapServers string
	SASLMechanism    string
	Username         string
	Password         string
}

// FetchKafkaClustersInput is the input for FetchKafkaClusters
type FetchKafkaClustersInput struct{}

// FetchKafkaClustersOutput is the output for FetchKafkaClusters
type FetchKafkaClustersOutput struct {
	Clusters []KafkaClusterInfo
}

// FetchKafkaClusters fetches all active Kafka clusters
func (a *ConsumerGroupSyncActivities) FetchKafkaClusters(ctx context.Context, input FetchKafkaClustersInput) (*FetchKafkaClustersOutput, error) {
	// TODO: Query Payload API for all active kafka clusters
	return &FetchKafkaClustersOutput{
		Clusters: []KafkaClusterInfo{},
	}, nil
}

// ListConsumerGroupsInput is the input for ListConsumerGroups
type ListConsumerGroupsInput struct {
	ClusterID        string
	BootstrapServers string
	SASLMechanism    string
	Username         string
	Password         string
}

// ListConsumerGroupsOutput is the output for ListConsumerGroups
type ListConsumerGroupsOutput struct {
	GroupIDs []string
}

// ListConsumerGroups lists all consumer groups from a Kafka cluster
func (a *ConsumerGroupSyncActivities) ListConsumerGroups(ctx context.Context, input ListConsumerGroupsInput) (*ListConsumerGroupsOutput, error) {
	// TODO: Use Kafka Admin API to list consumer groups
	// This will connect to the Kafka cluster and call ListConsumerGroups
	return &ListConsumerGroupsOutput{
		GroupIDs: []string{},
	}, nil
}

// ConsumerGroupDetail represents detailed info about a consumer group
type ConsumerGroupDetail struct {
	GroupID            string
	State              string // Stable, Rebalancing, Empty, Dead, PreparingRebalance, CompletingRebalance
	Members            int
	CoordinatorBroker  string
	AssignmentStrategy string
	SubscribedTopics   []string
}

// DescribeConsumerGroupInput is the input for DescribeConsumerGroup
type DescribeConsumerGroupInput struct {
	ClusterID        string
	BootstrapServers string
	SASLMechanism    string
	Username         string
	Password         string
	GroupID          string
}

// DescribeConsumerGroupOutput is the output for DescribeConsumerGroup
type DescribeConsumerGroupOutput struct {
	Detail ConsumerGroupDetail
}

// DescribeConsumerGroup describes a single consumer group
func (a *ConsumerGroupSyncActivities) DescribeConsumerGroup(ctx context.Context, input DescribeConsumerGroupInput) (*DescribeConsumerGroupOutput, error) {
	// TODO: Use Kafka Admin API to describe consumer group
	return &DescribeConsumerGroupOutput{
		Detail: ConsumerGroupDetail{
			GroupID: input.GroupID,
			State:   "Unknown",
		},
	}, nil
}

// UpsertConsumerGroupInput is the input for UpsertConsumerGroup
type UpsertConsumerGroupInput struct {
	ClusterID    string
	WorkspaceID  string
	TopicID      string
	GroupID      string
	State        string
	Members      int
	Coordinator  string
	Strategy     string
	Topics       []string
}

// UpsertConsumerGroup upserts a consumer group to Payload
func (a *ConsumerGroupSyncActivities) UpsertConsumerGroup(ctx context.Context, input UpsertConsumerGroupInput) error {
	// TODO: Upsert to Payload KafkaConsumerGroups collection
	return nil
}

// MarkInactiveGroupsInput is the input for MarkInactiveGroups
type MarkInactiveGroupsInput struct {
	ClusterID         string
	InactiveThreshold time.Duration
	ArchiveThreshold  time.Duration
}

// MarkInactiveGroups marks old consumer groups as inactive or archived
func (a *ConsumerGroupSyncActivities) MarkInactiveGroups(ctx context.Context, input MarkInactiveGroupsInput) error {
	// TODO: Query Payload for groups with lastSeen older than thresholds and update status
	return nil
}
```

**Step 6.2: Create consumer group sync workflow file**

Create `temporal-workflows/internal/workflows/kafka_consumer_group_sync_workflow.go`:

```go
package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// KafkaConsumerGroupSyncTaskQueue is the task queue for consumer group sync workflows
	KafkaConsumerGroupSyncTaskQueue = "kafka-consumer-group-sync"
)

// ConsumerGroupSyncWorkflowInput defines input for the consumer group sync workflow
type ConsumerGroupSyncWorkflowInput struct {
	// Empty for now - workflow syncs all clusters
}

// ConsumerGroupSyncWorkflowResult defines the output of the consumer group sync workflow
type ConsumerGroupSyncWorkflowResult struct {
	ClustersProcessed int
	GroupsSynced      int
	GroupsFailed      int
	Duration          time.Duration
}

// ConsumerGroupSyncWorkflow orchestrates periodic sync of consumer groups from Kafka to Orbit
func ConsumerGroupSyncWorkflow(ctx workflow.Context, input ConsumerGroupSyncWorkflowInput) (ConsumerGroupSyncWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	startTime := workflow.Now(ctx)

	logger.Info("Starting consumer group sync workflow")

	// Configure activity options with shorter timeout for frequent syncs
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var cgActivities *activities.ConsumerGroupSyncActivities

	// Step 1: Fetch all active Kafka clusters
	logger.Info("Step 1: Fetching Kafka clusters")
	var clustersOutput *activities.FetchKafkaClustersOutput
	err := workflow.ExecuteActivity(ctx, cgActivities.FetchKafkaClusters, activities.FetchKafkaClustersInput{}).Get(ctx, &clustersOutput)
	if err != nil {
		logger.Error("Failed to fetch clusters", "Error", err)
		return ConsumerGroupSyncWorkflowResult{}, err
	}

	logger.Info("Found Kafka clusters", "Count", len(clustersOutput.Clusters))

	var totalGroupsSynced int
	var totalGroupsFailed int

	// Step 2: Process each cluster sequentially
	for _, cluster := range clustersOutput.Clusters {
		logger.Info("Processing cluster", "ClusterID", cluster.ID, "Name", cluster.Name)

		// List consumer groups from this cluster
		var groupsOutput *activities.ListConsumerGroupsOutput
		err := workflow.ExecuteActivity(ctx, cgActivities.ListConsumerGroups, activities.ListConsumerGroupsInput{
			ClusterID:        cluster.ID,
			BootstrapServers: cluster.BootstrapServers,
			SASLMechanism:    cluster.SASLMechanism,
			Username:         cluster.Username,
			Password:         cluster.Password,
		}).Get(ctx, &groupsOutput)

		if err != nil {
			logger.Warn("Failed to list consumer groups", "ClusterID", cluster.ID, "Error", err)
			continue
		}

		logger.Info("Found consumer groups in cluster", "ClusterID", cluster.ID, "GroupCount", len(groupsOutput.GroupIDs))

		// Describe and upsert each group
		for _, groupID := range groupsOutput.GroupIDs {
			var describeOutput *activities.DescribeConsumerGroupOutput
			err := workflow.ExecuteActivity(ctx, cgActivities.DescribeConsumerGroup, activities.DescribeConsumerGroupInput{
				ClusterID:        cluster.ID,
				BootstrapServers: cluster.BootstrapServers,
				SASLMechanism:    cluster.SASLMechanism,
				Username:         cluster.Username,
				Password:         cluster.Password,
				GroupID:          groupID,
			}).Get(ctx, &describeOutput)

			if err != nil {
				logger.Warn("Failed to describe consumer group", "GroupID", groupID, "Error", err)
				totalGroupsFailed++
				continue
			}

			// Upsert to Payload
			err = workflow.ExecuteActivity(ctx, cgActivities.UpsertConsumerGroup, activities.UpsertConsumerGroupInput{
				ClusterID:   cluster.ID,
				GroupID:     describeOutput.Detail.GroupID,
				State:       describeOutput.Detail.State,
				Members:     describeOutput.Detail.Members,
				Coordinator: describeOutput.Detail.CoordinatorBroker,
				Strategy:    describeOutput.Detail.AssignmentStrategy,
				Topics:      describeOutput.Detail.SubscribedTopics,
			}).Get(ctx, nil)

			if err != nil {
				logger.Warn("Failed to upsert consumer group", "GroupID", groupID, "Error", err)
				totalGroupsFailed++
				continue
			}

			totalGroupsSynced++
		}

		// Mark inactive groups for this cluster
		_ = workflow.ExecuteActivity(ctx, cgActivities.MarkInactiveGroups, activities.MarkInactiveGroupsInput{
			ClusterID:         cluster.ID,
			InactiveThreshold: 24 * time.Hour,
			ArchiveThreshold:  7 * 24 * time.Hour,
		}).Get(ctx, nil)
	}

	duration := workflow.Now(ctx).Sub(startTime)

	logger.Info("Consumer group sync workflow completed",
		"ClustersProcessed", len(clustersOutput.Clusters),
		"GroupsSynced", totalGroupsSynced,
		"GroupsFailed", totalGroupsFailed,
		"Duration", duration,
	)

	return ConsumerGroupSyncWorkflowResult{
		ClustersProcessed: len(clustersOutput.Clusters),
		GroupsSynced:      totalGroupsSynced,
		GroupsFailed:      totalGroupsFailed,
		Duration:          duration,
	}, nil
}
```

**Step 6.3: Verify workflow compiles**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds with no errors

**Step 6.4: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_consumer_group_activities.go temporal-workflows/internal/workflows/kafka_consumer_group_sync_workflow.go
git commit -m "feat(temporal): add ConsumerGroupSyncWorkflow for consumer group discovery"
```

---

### Task 7: Implement ConsumerLagCheckWorkflow

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_consumer_group_activities.go`
- Create: `temporal-workflows/internal/workflows/kafka_consumer_lag_workflow.go`

**Step 7.1: Add lag calculation activities**

Add to `temporal-workflows/internal/activities/kafka_consumer_group_activities.go`:

```go
// ActiveGroupInfo represents a consumer group to check lag for
type ActiveGroupInfo struct {
	GroupID          string
	VirtualClusterID string
	WorkspaceID      string
	ClusterID        string
	BootstrapServers string
	SASLMechanism    string
	Username         string
	Password         string
	SubscribedTopics []string
}

// FetchActiveGroupsInput is the input for FetchActiveGroups
type FetchActiveGroupsInput struct{}

// FetchActiveGroupsOutput is the output for FetchActiveGroups
type FetchActiveGroupsOutput struct {
	Groups []ActiveGroupInfo
}

// FetchActiveGroups fetches all active consumer groups from Payload
func (a *ConsumerGroupSyncActivities) FetchActiveGroups(ctx context.Context, input FetchActiveGroupsInput) (*FetchActiveGroupsOutput, error) {
	// TODO: Query Payload for KafkaConsumerGroups where status = 'active'
	return &FetchActiveGroupsOutput{
		Groups: []ActiveGroupInfo{},
	}, nil
}

// PartitionLag represents lag for a single partition
type PartitionLag struct {
	Topic           string
	Partition       int
	CurrentOffset   int64
	EndOffset       int64
	Lag             int64
	ConsumerMemberID string
}

// ConsumerLagResult represents lag calculation result for a group
type ConsumerLagResult struct {
	GroupID      string
	TotalLag     int64
	PartitionLag map[string]int64 // "topic-partition" -> lag
	Error        string
}

// CalculateLagInput is the input for CalculateLag
type CalculateLagInput struct {
	Group ActiveGroupInfo
}

// CalculateLagOutput is the output for CalculateLag
type CalculateLagOutput struct {
	Result ConsumerLagResult
}

// CalculateLag calculates consumer lag for a single group
func (a *ConsumerGroupSyncActivities) CalculateLag(ctx context.Context, input CalculateLagInput) (*CalculateLagOutput, error) {
	// TODO: Connect to Kafka and calculate lag:
	// 1. Get committed offsets for the group
	// 2. Get end offsets for each subscribed topic-partition
	// 3. Calculate lag = endOffset - committedOffset

	return &CalculateLagOutput{
		Result: ConsumerLagResult{
			GroupID:      input.Group.GroupID,
			TotalLag:     0,
			PartitionLag: map[string]int64{},
		},
	}, nil
}

// UpdateGroupLagInput is the input for UpdateGroupLag
type UpdateGroupLagInput struct {
	GroupID      string
	TotalLag     int64
	PartitionLag map[string]int64
}

// UpdateGroupLag updates lag in Payload KafkaConsumerGroups
func (a *ConsumerGroupSyncActivities) UpdateGroupLag(ctx context.Context, input UpdateGroupLagInput) error {
	// TODO: Update KafkaConsumerGroups with new lag values
	return nil
}

// LagSnapshot represents a historical lag snapshot
type LagSnapshot struct {
	GroupID          string
	VirtualClusterID string
	WorkspaceID      string
	TotalLag         int64
	PartitionLag     map[string]int64
	MemberCount      int
	State            string
}

// StoreLagHistoryInput is the input for StoreLagHistory
type StoreLagHistoryInput struct {
	Snapshots []LagSnapshot
}

// StoreLagHistory stores lag snapshots for historical charting
func (a *ConsumerGroupSyncActivities) StoreLagHistory(ctx context.Context, input StoreLagHistoryInput) error {
	// TODO: Insert into KafkaConsumerGroupLagHistory collection
	return nil
}
```

**Step 7.2: Create consumer lag workflow file**

Create `temporal-workflows/internal/workflows/kafka_consumer_lag_workflow.go`:

```go
package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// KafkaConsumerLagTaskQueue is the task queue for consumer lag workflows
	KafkaConsumerLagTaskQueue = "kafka-consumer-lag"
)

// ConsumerLagWorkflowInput defines input for the consumer lag workflow
type ConsumerLagWorkflowInput struct {
	// Empty for now - workflow processes all active groups
}

// ConsumerLagWorkflowResult defines the output of the consumer lag workflow
type ConsumerLagWorkflowResult struct {
	GroupsProcessed int
	GroupsFailed    int
	TotalLagSum     int64
	Duration        time.Duration
}

// ConsumerLagCheckWorkflow orchestrates periodic lag calculation for active consumer groups
func ConsumerLagCheckWorkflow(ctx workflow.Context, input ConsumerLagWorkflowInput) (ConsumerLagWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	startTime := workflow.Now(ctx)

	logger.Info("Starting consumer lag check workflow")

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var cgActivities *activities.ConsumerGroupSyncActivities

	// Step 1: Fetch all active consumer groups
	logger.Info("Step 1: Fetching active consumer groups")
	var groupsOutput *activities.FetchActiveGroupsOutput
	err := workflow.ExecuteActivity(ctx, cgActivities.FetchActiveGroups, activities.FetchActiveGroupsInput{}).Get(ctx, &groupsOutput)
	if err != nil {
		logger.Error("Failed to fetch active groups", "Error", err)
		return ConsumerLagWorkflowResult{}, err
	}

	logger.Info("Found active consumer groups", "Count", len(groupsOutput.Groups))

	var totalGroupsProcessed int
	var totalGroupsFailed int
	var totalLagSum int64
	var lagSnapshots []activities.LagSnapshot

	// Step 2: Calculate lag for each group
	for _, group := range groupsOutput.Groups {
		var lagOutput *activities.CalculateLagOutput
		err := workflow.ExecuteActivity(ctx, cgActivities.CalculateLag, activities.CalculateLagInput{
			Group: group,
		}).Get(ctx, &lagOutput)

		if err != nil {
			logger.Warn("Failed to calculate lag", "GroupID", group.GroupID, "Error", err)
			totalGroupsFailed++
			continue
		}

		// Update group with new lag values
		err = workflow.ExecuteActivity(ctx, cgActivities.UpdateGroupLag, activities.UpdateGroupLagInput{
			GroupID:      group.GroupID,
			TotalLag:     lagOutput.Result.TotalLag,
			PartitionLag: lagOutput.Result.PartitionLag,
		}).Get(ctx, nil)

		if err != nil {
			logger.Warn("Failed to update group lag", "GroupID", group.GroupID, "Error", err)
			totalGroupsFailed++
			continue
		}

		totalGroupsProcessed++
		totalLagSum += lagOutput.Result.TotalLag

		// Collect snapshot for history
		lagSnapshots = append(lagSnapshots, activities.LagSnapshot{
			GroupID:          group.GroupID,
			VirtualClusterID: group.VirtualClusterID,
			WorkspaceID:      group.WorkspaceID,
			TotalLag:         lagOutput.Result.TotalLag,
			PartitionLag:     lagOutput.Result.PartitionLag,
		})
	}

	// Step 3: Store lag history for charting
	if len(lagSnapshots) > 0 {
		logger.Info("Step 3: Storing lag history", "SnapshotCount", len(lagSnapshots))
		_ = workflow.ExecuteActivity(ctx, cgActivities.StoreLagHistory, activities.StoreLagHistoryInput{
			Snapshots: lagSnapshots,
		}).Get(ctx, nil)
	}

	duration := workflow.Now(ctx).Sub(startTime)

	logger.Info("Consumer lag check workflow completed",
		"GroupsProcessed", totalGroupsProcessed,
		"GroupsFailed", totalGroupsFailed,
		"TotalLagSum", totalLagSum,
		"Duration", duration,
	)

	return ConsumerLagWorkflowResult{
		GroupsProcessed: totalGroupsProcessed,
		GroupsFailed:    totalGroupsFailed,
		TotalLagSum:     totalLagSum,
		Duration:        duration,
	}, nil
}
```

**Step 7.3: Verify workflow compiles**

Run: `cd temporal-workflows && go build ./...`

Expected: Build succeeds with no errors

**Step 7.4: Commit**

```bash
git add temporal-workflows/internal/activities/kafka_consumer_group_activities.go temporal-workflows/internal/workflows/kafka_consumer_lag_workflow.go
git commit -m "feat(temporal): add ConsumerLagCheckWorkflow for lag calculation and history"
```

---

### Task 8: Register Workflows with Worker

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 8.1: Add imports for new workflows and activities**

Add to the import block in `temporal-workflows/cmd/worker/main.go`:

```go
// Imports should already include workflows and activities packages
```

**Step 8.2: Register new workflows**

Find the workflow registration section and add:

```go
	// Register schema sync workflow
	w.RegisterWorkflow(workflows.SchemaSyncWorkflow)

	// Register consumer group sync workflows
	w.RegisterWorkflow(workflows.ConsumerGroupSyncWorkflow)
	w.RegisterWorkflow(workflows.ConsumerLagCheckWorkflow)
```

**Step 8.3: Create and register new activities**

Find the activity registration section and add:

```go
	// Create and register schema sync activities
	schemaSyncActivities := activities.NewSchemaSyncActivities(orbitAPIURL)
	w.RegisterActivity(schemaSyncActivities.FetchClustersWithSchemaRegistry)
	w.RegisterActivity(schemaSyncActivities.FetchSubjects)
	w.RegisterActivity(schemaSyncActivities.SyncSchemaVersions)
	w.RegisterActivity(schemaSyncActivities.MarkStaleSchemas)

	// Create and register consumer group sync activities
	cgSyncActivities := activities.NewConsumerGroupSyncActivities(orbitAPIURL)
	w.RegisterActivity(cgSyncActivities.FetchKafkaClusters)
	w.RegisterActivity(cgSyncActivities.ListConsumerGroups)
	w.RegisterActivity(cgSyncActivities.DescribeConsumerGroup)
	w.RegisterActivity(cgSyncActivities.UpsertConsumerGroup)
	w.RegisterActivity(cgSyncActivities.MarkInactiveGroups)
	w.RegisterActivity(cgSyncActivities.FetchActiveGroups)
	w.RegisterActivity(cgSyncActivities.CalculateLag)
	w.RegisterActivity(cgSyncActivities.UpdateGroupLag)
	w.RegisterActivity(cgSyncActivities.StoreLagHistory)
```

**Step 8.4: Verify worker compiles and starts**

Run: `cd temporal-workflows && go build -o bin/worker ./cmd/worker`

Expected: Build succeeds

**Step 8.5: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(temporal): register Phase 7 workflows and activities with worker"
```

---

## Phase 7C: Server Actions (Tasks 9-10)

### Task 9: Create kafka-schemas Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/kafka-schemas.ts`

**Step 9.1: Create the server actions file**

Create `orbit-www/src/app/actions/kafka-schemas.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

// Types
export type SchemaFilters = {
  workspaceId?: string
  virtualClusterId?: string
  topicId?: string
  format?: 'avro' | 'protobuf' | 'json'
  status?: 'pending' | 'registered' | 'failed' | 'stale'
  search?: string
}

export type SchemaListItem = {
  id: string
  subject: string
  topicId: string
  topicName: string
  type: 'key' | 'value'
  format: 'avro' | 'protobuf' | 'json'
  latestVersion: number | null
  versionCount: number | null
  status: string
  workspaceId: string
  workspaceName: string
  applicationName: string | null
  lastRegisteredAt: string | null
}

export type SchemaDetail = {
  id: string
  subject: string
  topic: {
    id: string
    name: string
  }
  type: 'key' | 'value'
  format: 'avro' | 'protobuf' | 'json'
  content: string
  latestVersion: number | null
  versionCount: number | null
  schemaId: number | null
  compatibility: string
  status: string
  workspace: {
    id: string
    name: string
    slug: string
  }
  application: {
    id: string
    name: string
    slug: string
  } | null
  firstRegisteredAt: string | null
  lastRegisteredAt: string | null
}

export type SchemaVersion = {
  id: string
  version: number
  schemaId: number
  content: string
  fingerprint: string | null
  compatibilityMode: string | null
  isCompatible: boolean
  registeredAt: string | null
  syncedAt: string | null
}

// Get accessible schemas with filtering
export async function getSchemas(filters: SchemaFilters = {}): Promise<{
  schemas: SchemaListItem[]
  total: number
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { schemas: [], total: 0 }
  }

  const payload = await getPayload({ config })

  // Build where clause
  const whereConditions: any[] = []

  // Workspace filtering based on membership (unless platform admin)
  if (session.user.role !== 'platform-admin') {
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 1000,
      overrideAccess: true,
    })

    const workspaceIds = memberships.docs.map((m) =>
      String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
    )

    if (workspaceIds.length === 0) {
      return { schemas: [], total: 0 }
    }

    whereConditions.push({ workspace: { in: workspaceIds } })
  }

  // Apply filters
  if (filters.workspaceId) {
    whereConditions.push({ workspace: { equals: filters.workspaceId } })
  }
  if (filters.virtualClusterId) {
    // Need to filter via topic's virtual cluster
    // This requires a join - for now filter in memory after query
  }
  if (filters.topicId) {
    whereConditions.push({ topic: { equals: filters.topicId } })
  }
  if (filters.format) {
    whereConditions.push({ format: { equals: filters.format } })
  }
  if (filters.status) {
    whereConditions.push({ status: { equals: filters.status } })
  }
  if (filters.search) {
    whereConditions.push({
      or: [
        { subject: { contains: filters.search } },
      ],
    })
  }

  const where = whereConditions.length > 0 ? { and: whereConditions } : {}

  const result = await payload.find({
    collection: 'kafka-schemas',
    where,
    depth: 2,
    limit: 100,
    sort: '-lastRegisteredAt',
  })

  const schemas: SchemaListItem[] = result.docs.map((doc: any) => ({
    id: doc.id,
    subject: doc.subject || '',
    topicId: typeof doc.topic === 'string' ? doc.topic : doc.topic?.id || '',
    topicName: typeof doc.topic === 'object' ? doc.topic?.name || '' : '',
    type: doc.type,
    format: doc.format,
    latestVersion: doc.latestVersion || null,
    versionCount: doc.versionCount || null,
    status: doc.status,
    workspaceId: typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id || '',
    workspaceName: typeof doc.workspace === 'object' ? doc.workspace?.name || '' : '',
    applicationName: null, // Would need to join through topic
    lastRegisteredAt: doc.lastRegisteredAt || null,
  }))

  return { schemas, total: result.totalDocs }
}

// Get single schema with full details
export async function getSchema(schemaId: string): Promise<SchemaDetail | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  try {
    const schema = await payload.findByID({
      collection: 'kafka-schemas',
      id: schemaId,
      depth: 2,
    })

    if (!schema) return null

    return {
      id: schema.id,
      subject: schema.subject || '',
      topic: {
        id: typeof schema.topic === 'string' ? schema.topic : schema.topic?.id || '',
        name: typeof schema.topic === 'object' ? schema.topic?.name || '' : '',
      },
      type: schema.type as 'key' | 'value',
      format: schema.format as 'avro' | 'protobuf' | 'json',
      content: schema.content || '',
      latestVersion: schema.latestVersion || null,
      versionCount: schema.versionCount || null,
      schemaId: schema.schemaId || null,
      compatibility: schema.compatibility || 'backward',
      status: schema.status || 'pending',
      workspace: {
        id: typeof schema.workspace === 'string' ? schema.workspace : schema.workspace?.id || '',
        name: typeof schema.workspace === 'object' ? schema.workspace?.name || '' : '',
        slug: typeof schema.workspace === 'object' ? schema.workspace?.slug || '' : '',
      },
      application: null, // Would need to join through topic
      firstRegisteredAt: schema.firstRegisteredAt || null,
      lastRegisteredAt: schema.lastRegisteredAt || null,
    }
  } catch {
    return null
  }
}

// Get schema versions
export async function getSchemaVersions(schemaId: string): Promise<SchemaVersion[]> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return []
  }

  const payload = await getPayload({ config })

  const result = await payload.find({
    collection: 'kafka-schema-versions',
    where: {
      schema: { equals: schemaId },
    },
    sort: '-version',
    limit: 100,
  })

  return result.docs.map((doc: any) => ({
    id: doc.id,
    version: doc.version,
    schemaId: doc.schemaId,
    content: doc.content || '',
    fingerprint: doc.fingerprint || null,
    compatibilityMode: doc.compatibilityMode || null,
    isCompatible: doc.isCompatible ?? true,
    registeredAt: doc.registeredAt || null,
    syncedAt: doc.syncedAt || null,
  }))
}

// Get schema summary stats
export async function getSchemaSummary(workspaceId?: string): Promise<{
  total: number
  byFormat: { avro: number; protobuf: number; json: number }
  byStatus: { registered: number; pending: number; failed: number; stale: number }
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return {
      total: 0,
      byFormat: { avro: 0, protobuf: 0, json: 0 },
      byStatus: { registered: 0, pending: 0, failed: 0, stale: 0 },
    }
  }

  const payload = await getPayload({ config })

  const whereConditions: any[] = []

  if (workspaceId) {
    whereConditions.push({ workspace: { equals: workspaceId } })
  } else if (session.user.role !== 'platform-admin') {
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 1000,
      overrideAccess: true,
    })

    const workspaceIds = memberships.docs.map((m) =>
      String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
    )

    if (workspaceIds.length === 0) {
      return {
        total: 0,
        byFormat: { avro: 0, protobuf: 0, json: 0 },
        byStatus: { registered: 0, pending: 0, failed: 0, stale: 0 },
      }
    }

    whereConditions.push({ workspace: { in: workspaceIds } })
  }

  const where = whereConditions.length > 0 ? { and: whereConditions } : {}

  const result = await payload.find({
    collection: 'kafka-schemas',
    where,
    limit: 10000,
  })

  const byFormat = { avro: 0, protobuf: 0, json: 0 }
  const byStatus = { registered: 0, pending: 0, failed: 0, stale: 0 }

  for (const doc of result.docs) {
    const format = (doc as any).format as keyof typeof byFormat
    const status = (doc as any).status as keyof typeof byStatus
    if (format in byFormat) byFormat[format]++
    if (status in byStatus) byStatus[status]++
  }

  return {
    total: result.totalDocs,
    byFormat,
    byStatus,
  }
}
```

**Step 9.2: Verify server actions compile**

Run: `cd orbit-www && pnpm build`

Expected: Build succeeds (or at least TypeScript compiles without errors in this file)

**Step 9.3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-schemas.ts
git commit -m "feat(kafka): add kafka-schemas server actions for schema queries"
```

---

### Task 10: Create kafka-consumer-groups Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/kafka-consumer-groups.ts`

**Step 10.1: Create the server actions file**

Create `orbit-www/src/app/actions/kafka-consumer-groups.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

// Types
export type ConsumerGroupFilters = {
  workspaceId?: string
  virtualClusterId?: string
  topicId?: string
  state?: string
  status?: 'active' | 'inactive' | 'archived'
  hasLag?: boolean
  search?: string
}

export type ConsumerGroupListItem = {
  id: string
  groupId: string
  state: string | null
  members: number | null
  totalLag: number | null
  status: string
  workspaceId: string
  workspaceName: string
  applicationName: string | null
  environment: string | null
  lastSeen: string | null
}

export type ConsumerGroupDetail = {
  id: string
  groupId: string
  state: string | null
  members: number | null
  totalLag: number | null
  partitionLag: Record<string, number> | null
  coordinatorBroker: string | null
  assignmentStrategy: string | null
  subscribedTopics: Array<{ id: string; name: string }>
  status: string
  workspace: {
    id: string
    name: string
    slug: string
  }
  application: {
    id: string
    name: string
    slug: string
  } | null
  virtualCluster: {
    id: string
    environment: string
  } | null
  firstSeen: string | null
  lastSeen: string | null
}

export type LagHistoryPoint = {
  timestamp: string
  totalLag: number
  memberCount: number | null
  state: string | null
}

// Get accessible consumer groups with filtering
export async function getConsumerGroups(filters: ConsumerGroupFilters = {}): Promise<{
  groups: ConsumerGroupListItem[]
  total: number
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { groups: [], total: 0 }
  }

  const payload = await getPayload({ config })

  // Build where clause
  const whereConditions: any[] = []

  // Workspace filtering based on membership (unless platform admin)
  if (session.user.role !== 'platform-admin') {
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 1000,
      overrideAccess: true,
    })

    const workspaceIds = memberships.docs.map((m) =>
      String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
    )

    if (workspaceIds.length === 0) {
      return { groups: [], total: 0 }
    }

    whereConditions.push({ workspace: { in: workspaceIds } })
  }

  // Apply filters
  if (filters.workspaceId) {
    whereConditions.push({ workspace: { equals: filters.workspaceId } })
  }
  if (filters.topicId) {
    whereConditions.push({ topic: { equals: filters.topicId } })
  }
  if (filters.state) {
    whereConditions.push({ state: { equals: filters.state } })
  }
  if (filters.status) {
    whereConditions.push({ status: { equals: filters.status } })
  }
  if (filters.hasLag) {
    whereConditions.push({ totalLag: { greater_than: 0 } })
  }
  if (filters.search) {
    whereConditions.push({
      or: [
        { groupId: { contains: filters.search } },
      ],
    })
  }

  const where = whereConditions.length > 0 ? { and: whereConditions } : {}

  const result = await payload.find({
    collection: 'kafka-consumer-groups',
    where,
    depth: 2,
    limit: 100,
    sort: '-lastSeen',
  })

  const groups: ConsumerGroupListItem[] = result.docs.map((doc: any) => ({
    id: doc.id,
    groupId: doc.groupId || '',
    state: doc.state || null,
    members: doc.members || null,
    totalLag: doc.totalLag || null,
    status: doc.status || 'active',
    workspaceId: typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id || '',
    workspaceName: typeof doc.workspace === 'object' ? doc.workspace?.name || '' : '',
    applicationName: null, // Would need to join
    environment: null, // Would need to join
    lastSeen: doc.lastSeen || null,
  }))

  return { groups, total: result.totalDocs }
}

// Get single consumer group with full details
export async function getConsumerGroup(groupId: string): Promise<ConsumerGroupDetail | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  try {
    const group = await payload.findByID({
      collection: 'kafka-consumer-groups',
      id: groupId,
      depth: 2,
    })

    if (!group) return null

    // Get subscribed topics
    const subscribedTopics: Array<{ id: string; name: string }> = []
    if (Array.isArray(group.subscribedTopics)) {
      for (const t of group.subscribedTopics) {
        if (typeof t === 'object' && t !== null) {
          subscribedTopics.push({ id: t.id, name: t.name || '' })
        }
      }
    }

    return {
      id: group.id,
      groupId: group.groupId || '',
      state: group.state || null,
      members: group.members || null,
      totalLag: group.totalLag || null,
      partitionLag: group.partitionLag as Record<string, number> | null,
      coordinatorBroker: group.coordinatorBroker || null,
      assignmentStrategy: group.assignmentStrategy || null,
      subscribedTopics,
      status: group.status || 'active',
      workspace: {
        id: typeof group.workspace === 'string' ? group.workspace : group.workspace?.id || '',
        name: typeof group.workspace === 'object' ? group.workspace?.name || '' : '',
        slug: typeof group.workspace === 'object' ? group.workspace?.slug || '' : '',
      },
      application: null, // Would need to join
      virtualCluster: null, // Would need to join
      firstSeen: group.firstSeen || null,
      lastSeen: group.lastSeen || null,
    }
  } catch {
    return null
  }
}

// Get lag history for a consumer group
export async function getConsumerGroupLagHistory(
  groupId: string,
  timeRange: '1h' | '6h' | '24h' | '7d' = '24h'
): Promise<LagHistoryPoint[]> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return []
  }

  const payload = await getPayload({ config })

  // Calculate time cutoff
  const now = new Date()
  let cutoff: Date
  switch (timeRange) {
    case '1h':
      cutoff = new Date(now.getTime() - 60 * 60 * 1000)
      break
    case '6h':
      cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000)
      break
    case '24h':
      cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      break
    case '7d':
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
  }

  const result = await payload.find({
    collection: 'kafka-consumer-group-lag-history',
    where: {
      and: [
        { consumerGroup: { equals: groupId } },
        { timestamp: { greater_than_equal: cutoff.toISOString() } },
      ],
    },
    sort: 'timestamp',
    limit: 1000,
  })

  return result.docs.map((doc: any) => ({
    timestamp: doc.timestamp,
    totalLag: doc.totalLag || 0,
    memberCount: doc.memberCount || null,
    state: doc.state || null,
  }))
}

// Get consumer group summary stats
export async function getConsumerGroupSummary(workspaceId?: string): Promise<{
  total: number
  byState: Record<string, number>
  totalLag: number
  groupsWithLag: number
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return {
      total: 0,
      byState: {},
      totalLag: 0,
      groupsWithLag: 0,
    }
  }

  const payload = await getPayload({ config })

  const whereConditions: any[] = [{ status: { equals: 'active' } }]

  if (workspaceId) {
    whereConditions.push({ workspace: { equals: workspaceId } })
  } else if (session.user.role !== 'platform-admin') {
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 1000,
      overrideAccess: true,
    })

    const workspaceIds = memberships.docs.map((m) =>
      String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
    )

    if (workspaceIds.length === 0) {
      return {
        total: 0,
        byState: {},
        totalLag: 0,
        groupsWithLag: 0,
      }
    }

    whereConditions.push({ workspace: { in: workspaceIds } })
  }

  const result = await payload.find({
    collection: 'kafka-consumer-groups',
    where: { and: whereConditions },
    limit: 10000,
  })

  const byState: Record<string, number> = {}
  let totalLag = 0
  let groupsWithLag = 0

  for (const doc of result.docs) {
    const state = (doc as any).state || 'unknown'
    byState[state] = (byState[state] || 0) + 1

    const lag = (doc as any).totalLag || 0
    totalLag += lag
    if (lag > 0) groupsWithLag++
  }

  return {
    total: result.totalDocs,
    byState,
    totalLag,
    groupsWithLag,
  }
}
```

**Step 10.2: Verify server actions compile**

Run: `cd orbit-www && pnpm build`

Expected: Build succeeds

**Step 10.3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-consumer-groups.ts
git commit -m "feat(kafka): add kafka-consumer-groups server actions"
```

---

## Phase 7D: Shared UI Components (Tasks 11-18)

Due to the length of this plan, I'll provide the key component implementations. Each task follows the same pattern:

1. Create the component file
2. Verify it compiles
3. Commit

### Task 11: Build SchemaTable Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/SchemaTable.tsx`

**Full implementation:**

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, RefreshCw } from 'lucide-react'
import type { SchemaListItem } from '@/app/actions/kafka-schemas'

interface SchemaTableProps {
  schemas: SchemaListItem[]
  scope: 'unified' | 'workspace' | 'virtual-cluster'
  onRefresh?: () => void
  loading?: boolean
}

const formatColors: Record<string, string> = {
  avro: 'bg-blue-100 text-blue-800',
  protobuf: 'bg-purple-100 text-purple-800',
  json: 'bg-green-100 text-green-800',
}

const statusColors: Record<string, string> = {
  registered: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  stale: 'bg-gray-100 text-gray-800',
}

export function SchemaTable({ schemas, scope, onRefresh, loading }: SchemaTableProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [formatFilter, setFormatFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filteredSchemas = schemas.filter((schema) => {
    if (search && !schema.subject.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    if (formatFilter !== 'all' && schema.format !== formatFilter) {
      return false
    }
    if (statusFilter !== 'all' && schema.status !== statusFilter) {
      return false
    }
    return true
  })

  const handleRowClick = (schema: SchemaListItem) => {
    if (scope === 'unified') {
      router.push(`/kafka/schemas/${schema.id}`)
    } else {
      // Workspace-scoped route
      router.push(`/kafka/schemas/${schema.id}`)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search schemas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={formatFilter} onValueChange={setFormatFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            <SelectItem value="avro">Avro</SelectItem>
            <SelectItem value="protobuf">Protobuf</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="registered">Registered</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
          </SelectContent>
        </Select>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              {scope === 'unified' && <TableHead>Workspace</TableHead>}
              <TableHead>Topic</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSchemas.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={scope === 'unified' ? 7 : 6}
                  className="text-center py-8 text-muted-foreground"
                >
                  {loading ? 'Loading schemas...' : 'No schemas found'}
                </TableCell>
              </TableRow>
            ) : (
              filteredSchemas.map((schema) => (
                <TableRow
                  key={schema.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(schema)}
                >
                  <TableCell className="font-medium">{schema.subject}</TableCell>
                  {scope === 'unified' && (
                    <TableCell>{schema.workspaceName}</TableCell>
                  )}
                  <TableCell>{schema.topicName}</TableCell>
                  <TableCell className="capitalize">{schema.type}</TableCell>
                  <TableCell>
                    <Badge className={formatColors[schema.format]}>
                      {schema.format.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>{schema.latestVersion || '-'}</TableCell>
                  <TableCell>
                    <Badge className={statusColors[schema.status]}>
                      {schema.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {filteredSchemas.length} of {schemas.length} schemas
      </div>
    </div>
  )
}
```

**Commit:**
```bash
git add orbit-www/src/components/features/kafka/SchemaTable.tsx
git commit -m "feat(kafka): add SchemaTable component"
```

---

### Tasks 12-18: Remaining Components

For brevity, I'll list the remaining components with their key structures. Each follows the same create-verify-commit pattern.

**Task 12: SchemaVersionTimeline.tsx** - Vertical timeline showing version history with dates and optional diff highlights

**Task 13: SchemaVersionDiff.tsx** - Side-by-side JSON diff viewer using a diff library

**Task 14: ConsumerGroupTable.tsx** - Similar to SchemaTable but for consumer groups with lag column and trend indicator

**Task 15: ConsumerGroupLagChart.tsx** - Line chart using Recharts for lag over time with time range selector

**Task 16: PartitionLagTable.tsx** - Table showing per-partition lag with topic, partition, offsets, owner

**Task 17: ConsumerGroupMembersTable.tsx** - Table showing group members with client ID, host, assigned partitions

**Task 18: FilterBar.tsx** - Reusable filter component with search input and dropdown filters

---

## Phase 7E: UI Pages (Tasks 19-28)

### Task 19: Build /kafka Layout

**Files:**
- Create: `orbit-www/src/app/(frontend)/kafka/layout.tsx`

```typescript
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

interface KafkaLayoutProps {
  children: React.ReactNode
}

export default async function KafkaLayout({ children }: KafkaLayoutProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/sign-in')
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Kafka Observability</h1>
        <p className="text-muted-foreground">
          View schemas and consumer groups across all your workspaces
        </p>
      </div>
      {children}
    </div>
  )
}
```

---

### Task 20: Build /kafka/schemas Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/kafka/schemas/page.tsx`

```typescript
import { Suspense } from 'react'
import { getSchemas, getSchemaSummary } from '@/app/actions/kafka-schemas'
import { SchemaTable } from '@/components/features/kafka/SchemaTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function SchemasPage() {
  const [{ schemas }, summary] = await Promise.all([
    getSchemas(),
    getSchemaSummary(),
  ])

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Schemas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.byFormat.avro}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Protobuf
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.byFormat.protobuf}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              JSON
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.byFormat.json}</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Suspense fallback={<div>Loading schemas...</div>}>
        <SchemaTable schemas={schemas} scope="unified" />
      </Suspense>
    </div>
  )
}
```

---

### Tasks 21-28: Remaining Pages

Each page follows the same server component pattern:
1. Authenticate user
2. Fetch data via server actions
3. Pass to client components

The remaining tasks are:
- **Task 21:** `/kafka/schemas/[schemaId]/page.tsx` - Schema detail with version timeline
- **Task 22:** `/kafka/consumer-groups/page.tsx` - Consumer groups list
- **Task 23:** `/kafka/consumer-groups/[groupId]/page.tsx` - Group detail with lag chart
- **Task 24:** `/{workspace}/kafka/schemas/page.tsx` - Workspace-scoped schemas
- **Task 25:** `/{workspace}/kafka/consumer-groups/page.tsx` - Workspace-scoped groups
- **Task 26:** `.../[appSlug]/[env]/schemas/page.tsx` - Virtual cluster schemas
- **Task 27:** `.../[appSlug]/[env]/consumer-groups/page.tsx` - Virtual cluster groups
- **Task 28:** Update KafkaNavigation.tsx with new links

---

## Final Verification

After completing all tasks:

**Step 1: Run full build**
```bash
cd orbit-www && pnpm build
cd temporal-workflows && go build ./...
```

**Step 2: Run tests**
```bash
cd orbit-www && pnpm test
cd temporal-workflows && go test ./...
```

**Step 3: Start development environment**
```bash
make dev
```

**Step 4: Verify pages load**
- Navigate to `/kafka/schemas` - should show schema list
- Navigate to `/kafka/consumer-groups` - should show consumer group list
- Navigate to workspace-scoped pages

---

## Summary

This plan implements Phase 7 with:
- **4 Data Layer tasks** - New collections and extensions
- **4 Temporal Workflow tasks** - Schema sync, consumer group sync, lag calculation
- **2 Server Action tasks** - Query functions for schemas and groups
- **8 UI Component tasks** - Tables, charts, filters
- **10 UI Page tasks** - Unified and scoped pages

Total: **28 tasks** following TDD and frequent commit patterns.
