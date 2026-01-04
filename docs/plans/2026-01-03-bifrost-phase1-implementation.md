# Bifrost Phase 1: Foundation (MVP) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundation of Bifrost Gateway with basic Kafka protocol proxying, metadata rewriting, SNI routing, and control plane integration.

**Architecture:** Kotlin/Kroxylicious gateway that proxies Kafka traffic, rewrites MetadataResponse to advertise gateway addresses, routes based on SNI hostname, and receives configuration from Orbit via gRPC Admin API. Orbit provisions applications/virtual clusters via Temporal workflows.

**Tech Stack:** Kotlin 1.9+, Gradle 8.x, Kroxylicious, Netty, gRPC-Kotlin, Payload CMS collections, Temporal Go workflows, Next.js 15 React components.

**Reference Design:** `docs/plans/2026-01-03-kafka-gateway-self-service-design.md`

---

## Task 1: Create Gateway Directory Structure

**Files:**
- Create: `gateway/bifrost/build.gradle.kts`
- Create: `gateway/bifrost/settings.gradle.kts`
- Create: `gateway/bifrost/gradle.properties`
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/Application.kt`
- Create: `gateway/bifrost/.gitignore`

**Step 1: Create directory structure**

```bash
mkdir -p gateway/bifrost/src/main/kotlin/io/orbit/bifrost
mkdir -p gateway/bifrost/src/main/resources
mkdir -p gateway/bifrost/src/test/kotlin/io/orbit/bifrost
```

**Step 2: Create settings.gradle.kts**

```kotlin
// gateway/bifrost/settings.gradle.kts
rootProject.name = "bifrost"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
```

**Step 3: Create gradle.properties**

```properties
# gateway/bifrost/gradle.properties
kotlin.code.style=official
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
```

**Step 4: Create build.gradle.kts**

```kotlin
// gateway/bifrost/build.gradle.kts
plugins {
    kotlin("jvm") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    application
    id("com.google.protobuf") version "0.9.4"
}

group = "io.orbit"
version = "0.1.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    // Kroxylicious
    implementation("io.kroxylicious:kroxylicious-api:0.9.0")
    implementation("io.kroxylicious:kroxylicious-runtime:0.9.0")

    // Kafka
    implementation("org.apache.kafka:kafka-clients:3.6.1")

    // gRPC
    implementation("io.grpc:grpc-kotlin-stub:1.4.1")
    implementation("io.grpc:grpc-protobuf:1.60.0")
    implementation("io.grpc:grpc-netty-shaded:1.60.0")
    implementation("com.google.protobuf:protobuf-kotlin:3.25.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")

    // Logging
    implementation("io.github.microutils:kotlin-logging-jvm:3.0.5")
    implementation("ch.qos.logback:logback-classic:1.4.14")

    // Configuration
    implementation("com.typesafe:config:1.4.3")

    // Testing
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.1")
    testImplementation("io.mockk:mockk:1.13.8")
    testImplementation("org.testcontainers:kafka:1.19.3")
    testImplementation("org.testcontainers:junit-jupiter:1.19.3")
}

protobuf {
    protoc {
        artifact = "com.google.protobuf:protoc:3.25.1"
    }
    plugins {
        create("grpc") {
            artifact = "io.grpc:protoc-gen-grpc-java:1.60.0"
        }
        create("grpckt") {
            artifact = "io.grpc:protoc-gen-grpc-kotlin:1.4.1:jdk8@jar"
        }
    }
    generateProtoTasks {
        all().forEach {
            it.plugins {
                create("grpc")
                create("grpckt")
            }
            it.builtins {
                create("kotlin")
            }
        }
    }
}

application {
    mainClass.set("io.orbit.bifrost.ApplicationKt")
}

tasks.test {
    useJUnitPlatform()
}
```

**Step 5: Create Application.kt placeholder**

```kotlin
// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/Application.kt
package io.orbit.bifrost

import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

fun main(args: Array<String>) {
    logger.info { "Bifrost Gateway starting..." }
    // TODO: Initialize gateway
    logger.info { "Bifrost Gateway started" }
}
```

**Step 6: Create .gitignore**

```gitignore
# gateway/bifrost/.gitignore
.gradle/
build/
.idea/
*.iml
out/
.kotlin/
```

**Step 7: Verify Gradle setup**

Run: `cd gateway/bifrost && ./gradlew wrapper --gradle-version 8.5`
Run: `cd gateway/bifrost && ./gradlew build`
Expected: BUILD SUCCESSFUL

**Step 8: Commit**

```bash
git add gateway/bifrost/
git commit -m "feat(bifrost): initialize Kotlin/Gradle project structure

- Set up Gradle with Kotlin 1.9, Java 21
- Add Kroxylicious, Kafka, gRPC dependencies
- Add protobuf plugin for gRPC code generation
- Create placeholder Application.kt"
```

---

## Task 2: Create Proto Definitions

**Files:**
- Create: `proto/idp/gateway/v1/gateway.proto`
- Modify: `proto/buf.yaml` (add gateway module)

**Step 1: Create gateway.proto**

```protobuf
// proto/idp/gateway/v1/gateway.proto
syntax = "proto3";

package idp.gateway.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1;gatewayv1";

import "google/protobuf/timestamp.proto";

// ============================================================================
// Bifrost Admin Service (Control Plane → Gateway)
// ============================================================================

service BifrostAdminService {
  // Virtual Cluster lifecycle
  rpc UpsertVirtualCluster(UpsertVirtualClusterRequest) returns (UpsertVirtualClusterResponse);
  rpc DeleteVirtualCluster(DeleteVirtualClusterRequest) returns (DeleteVirtualClusterResponse);
  rpc SetVirtualClusterReadOnly(SetVirtualClusterReadOnlyRequest) returns (SetVirtualClusterReadOnlyResponse);

  // Full sync (startup reconciliation)
  rpc GetFullConfig(GetFullConfigRequest) returns (GetFullConfigResponse);

  // Health & observability
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
  rpc ListVirtualClusters(ListVirtualClustersRequest) returns (ListVirtualClustersResponse);
}

// ============================================================================
// Messages: Virtual Clusters
// ============================================================================

message VirtualClusterConfig {
  string id = 1;
  string application_id = 2;
  string application_slug = 3;
  string workspace_slug = 4;
  string environment = 5;
  string topic_prefix = 6;
  string group_prefix = 7;
  string transaction_id_prefix = 8;
  string advertised_host = 9;
  int32 advertised_port = 10;
  string physical_bootstrap_servers = 11;
  bool read_only = 12;
}

message UpsertVirtualClusterRequest {
  VirtualClusterConfig config = 1;
}

message UpsertVirtualClusterResponse {
  bool success = 1;
}

message DeleteVirtualClusterRequest {
  string virtual_cluster_id = 1;
}

message DeleteVirtualClusterResponse {
  bool success = 1;
}

message SetVirtualClusterReadOnlyRequest {
  string virtual_cluster_id = 1;
  bool read_only = 2;
}

message SetVirtualClusterReadOnlyResponse {
  bool success = 1;
}

// ============================================================================
// Messages: Full Config Sync
// ============================================================================

message GetFullConfigRequest {}

message GetFullConfigResponse {
  repeated VirtualClusterConfig virtual_clusters = 1;
}

// ============================================================================
// Messages: Status
// ============================================================================

message GetStatusRequest {}

message GetStatusResponse {
  string status = 1;
  int32 active_connections = 2;
  int32 virtual_cluster_count = 3;
  map<string, string> version_info = 4;
}

message ListVirtualClustersRequest {}

message ListVirtualClustersResponse {
  repeated VirtualClusterConfig virtual_clusters = 1;
}
```

**Step 2: Generate proto code**

Run: `make proto-gen`
Expected: Files generated in `proto/gen/go/idp/gateway/v1/` and `orbit-www/src/lib/proto/idp/gateway/v1/`

**Step 3: Verify generated Go code exists**

Run: `ls proto/gen/go/idp/gateway/v1/`
Expected: `gateway.pb.go`, `gateway_grpc.pb.go`

**Step 4: Commit**

```bash
git add proto/idp/gateway/v1/gateway.proto
git add proto/gen/go/idp/gateway/v1/
git add orbit-www/src/lib/proto/idp/gateway/v1/
git commit -m "feat(proto): add Bifrost Admin Service definitions

- Add BifrostAdminService with virtual cluster management RPCs
- Add VirtualClusterConfig message for gateway configuration
- Add GetFullConfig for startup reconciliation
- Add GetStatus for health monitoring"
```

---

## Task 3: Create KafkaApplications Payload Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/KafkaApplications.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create KafkaApplications collection**

```typescript
// orbit-www/src/collections/kafka/KafkaApplications.ts
import type { CollectionConfig, Where } from 'payload'

export const KafkaApplications: CollectionConfig = {
  slug: 'kafka-applications',
  admin: {
    useAsTitle: 'name',
    group: 'Kafka',
    defaultColumns: ['name', 'workspace', 'status', 'createdAt'],
    description: 'Kafka applications for self-service virtual clusters',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Platform admins can see all
      if (user.platformRole === 'super-admin' || user.platformRole === 'admin') {
        return true
      }

      // Regular users see only their workspace applications
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
    create: ({ req: { user } }) => !!user,
    update: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Platform admins can update any
      if (user.platformRole === 'super-admin' || user.platformRole === 'admin') {
        return true
      }

      const app = await payload.findByID({
        collection: 'kafka-applications',
        id: id as string,
        overrideAccess: true,
      })

      if (!app) return false

      const workspaceId =
        typeof app.workspace === 'string' ? app.workspace : app.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false

      // Platform admins can delete any
      if (user.platformRole === 'super-admin' || user.platformRole === 'admin') {
        return true
      }

      const app = await payload.findByID({
        collection: 'kafka-applications',
        id: id as string,
        overrideAccess: true,
      })

      if (!app) return false

      const workspaceId =
        typeof app.workspace === 'string' ? app.workspace : app.workspace.id

      const members = await payload.find({
        collection: 'workspace-members',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { user: { equals: user.id } },
            { role: { in: ['owner', 'admin'] } },
            { status: { equals: 'active' } },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })

      return members.docs.length > 0
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name for the application (e.g., "Payments Service")',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: false, // Unique within workspace, not globally
      index: true,
      admin: {
        description: 'URL-safe identifier (e.g., "payments-service")',
      },
      validate: (value: string | undefined | null) => {
        if (!value) return 'Slug is required'
        if (!/^[a-z][a-z0-9-]*$/.test(value)) {
          return 'Slug must start with a letter and contain only lowercase letters, numbers, and hyphens'
        }
        if (value.length > 63) {
          return 'Slug must be 63 characters or less'
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
      admin: {
        description: 'Workspace that owns this application',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional description of what this application does',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Decommissioning', value: 'decommissioning' },
        { label: 'Deleted', value: 'deleted' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'decommissioningStartedAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data) => data?.status === 'decommissioning',
      },
    },
    {
      name: 'deletedAt',
      type: 'date',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data) => data?.status === 'deleted',
      },
    },
    {
      name: 'deletedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'deleted',
      },
    },
    {
      name: 'forceDeleted',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'deleted',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ operation, data, req }) => {
        if (operation === 'create' && req.user) {
          data.createdBy = req.user.id
        }
        return data
      },
    ],
  },
  timestamps: true,
}
```

**Step 2: Export from kafka/index.ts**

Add to `orbit-www/src/collections/kafka/index.ts`:

```typescript
export { KafkaApplications } from './KafkaApplications'
```

**Step 3: Register in payload.config.ts**

Add `KafkaApplications` to the collections array in `orbit-www/src/payload.config.ts`.

**Step 4: Run Payload to verify collection**

Run: `cd orbit-www && bun run dev`
Expected: No TypeScript errors, collection appears in admin panel under "Kafka" group

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaApplications.ts
git add orbit-www/src/collections/kafka/index.ts
git add orbit-www/src/payload.config.ts
git commit -m "feat(collections): add KafkaApplications collection

- Workspace-scoped Kafka application definitions
- Lifecycle states: active, decommissioning, deleted
- Access control based on workspace membership
- Slug validation for URL-safe identifiers"
```

---

## Task 4: Create KafkaVirtualClusters Payload Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/KafkaVirtualClusters.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Create KafkaVirtualClusters collection**

```typescript
// orbit-www/src/collections/kafka/KafkaVirtualClusters.ts
import type { CollectionConfig, Where } from 'payload'

export const KafkaVirtualClusters: CollectionConfig = {
  slug: 'kafka-virtual-clusters',
  admin: {
    useAsTitle: 'advertisedHost',
    group: 'Kafka',
    defaultColumns: ['application', 'environment', 'status', 'createdAt'],
    description: 'Virtual clusters for Kafka applications (one per environment)',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // Platform admins can see all
      if (user.platformRole === 'super-admin' || user.platformRole === 'admin') {
        return true
      }

      // Regular users see only virtual clusters for their workspace applications
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

      // Find applications in user's workspaces
      const apps = await payload.find({
        collection: 'kafka-applications',
        where: {
          workspace: { in: workspaceIds },
        },
        limit: 1000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map((a) => a.id)

      return {
        application: { in: appIds },
      } as Where
    },
    create: ({ req: { user } }) => {
      // Only system/workflows can create virtual clusters
      return user?.platformRole === 'super-admin' || user?.platformRole === 'admin'
    },
    update: ({ req: { user } }) => {
      return user?.platformRole === 'super-admin' || user?.platformRole === 'admin'
    },
    delete: ({ req: { user } }) => {
      return user?.platformRole === 'super-admin' || user?.platformRole === 'admin'
    },
  },
  fields: [
    {
      name: 'application',
      type: 'relationship',
      relationTo: 'kafka-applications',
      required: true,
      index: true,
      admin: {
        description: 'Parent Kafka application',
      },
    },
    {
      name: 'environment',
      type: 'select',
      required: true,
      options: [
        { label: 'Development', value: 'dev' },
        { label: 'Staging', value: 'stage' },
        { label: 'Production', value: 'prod' },
      ],
      index: true,
      admin: {
        description: 'Target environment',
      },
    },
    {
      name: 'physicalCluster',
      type: 'relationship',
      relationTo: 'kafka-clusters',
      required: true,
      admin: {
        description: 'Backing physical Kafka cluster',
      },
    },
    {
      name: 'topicPrefix',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'Prefix for physical topic names (e.g., "acme-payments-dev-")',
      },
    },
    {
      name: 'groupPrefix',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'Prefix for consumer group IDs',
      },
    },
    {
      name: 'advertisedHost',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'Gateway hostname for clients (e.g., "payments-service.dev.kafka.orbit.io")',
      },
    },
    {
      name: 'advertisedPort',
      type: 'number',
      required: true,
      defaultValue: 9092,
      admin: {
        readOnly: true,
        description: 'Gateway port for clients',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'provisioning',
      options: [
        { label: 'Provisioning', value: 'provisioning' },
        { label: 'Active', value: 'active' },
        { label: 'Read Only', value: 'read_only' },
        { label: 'Deleting', value: 'deleting' },
        { label: 'Deleted', value: 'deleted' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'provisioningError',
      type: 'textarea',
      admin: {
        readOnly: true,
        condition: (data) => data?.status === 'provisioning',
        description: 'Error message if provisioning failed',
      },
    },
  ],
  timestamps: true,
  indexes: [
    {
      name: 'unique_app_env',
      fields: ['application', 'environment'],
      unique: true,
    },
  ],
}
```

**Step 2: Export from kafka/index.ts**

Add to `orbit-www/src/collections/kafka/index.ts`:

```typescript
export { KafkaVirtualClusters } from './KafkaVirtualClusters'
```

**Step 3: Register in payload.config.ts**

Add `KafkaVirtualClusters` to the collections array.

**Step 4: Run Payload to verify**

Run: `cd orbit-www && bun run dev`
Expected: No TypeScript errors, collection appears in admin panel

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaVirtualClusters.ts
git add orbit-www/src/collections/kafka/index.ts
git add orbit-www/src/payload.config.ts
git commit -m "feat(collections): add KafkaVirtualClusters collection

- One virtual cluster per application/environment
- Links to physical cluster via environment mapping
- Stores gateway hostname and prefixes
- Unique constraint on application+environment"
```

---

## Task 5: Create Bifrost gRPC Admin Server

**Files:**
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/AdminServer.kt`
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt`
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/config/VirtualClusterStore.kt`

**Step 1: Create VirtualClusterStore**

```kotlin
// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/config/VirtualClusterStore.kt
package io.orbit.bifrost.config

import io.orbit.bifrost.proto.VirtualClusterConfig
import mu.KotlinLogging
import java.util.concurrent.ConcurrentHashMap

private val logger = KotlinLogging.logger {}

/**
 * Thread-safe in-memory store for virtual cluster configurations.
 * Updated via gRPC Admin API.
 */
class VirtualClusterStore {
    private val clusters = ConcurrentHashMap<String, VirtualClusterConfig>()

    fun upsert(config: VirtualClusterConfig) {
        clusters[config.id] = config
        logger.info { "Upserted virtual cluster: ${config.id} (${config.advertisedHost})" }
    }

    fun delete(id: String): Boolean {
        val removed = clusters.remove(id)
        if (removed != null) {
            logger.info { "Deleted virtual cluster: $id" }
        }
        return removed != null
    }

    fun get(id: String): VirtualClusterConfig? = clusters[id]

    fun getByHost(host: String): VirtualClusterConfig? {
        return clusters.values.find { it.advertisedHost == host }
    }

    fun getAll(): List<VirtualClusterConfig> = clusters.values.toList()

    fun count(): Int = clusters.size

    fun clear() {
        clusters.clear()
        logger.info { "Cleared all virtual clusters" }
    }
}
```

**Step 2: Create BifrostAdminServiceImpl**

```kotlin
// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt
package io.orbit.bifrost.admin

import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.proto.*
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

class BifrostAdminServiceImpl(
    private val store: VirtualClusterStore
) : BifrostAdminServiceGrpcKt.BifrostAdminServiceCoroutineImplBase() {

    override suspend fun upsertVirtualCluster(
        request: UpsertVirtualClusterRequest
    ): UpsertVirtualClusterResponse {
        logger.info { "UpsertVirtualCluster: ${request.config.id}" }
        store.upsert(request.config)
        return UpsertVirtualClusterResponse.newBuilder()
            .setSuccess(true)
            .build()
    }

    override suspend fun deleteVirtualCluster(
        request: DeleteVirtualClusterRequest
    ): DeleteVirtualClusterResponse {
        logger.info { "DeleteVirtualCluster: ${request.virtualClusterId}" }
        val success = store.delete(request.virtualClusterId)
        return DeleteVirtualClusterResponse.newBuilder()
            .setSuccess(success)
            .build()
    }

    override suspend fun setVirtualClusterReadOnly(
        request: SetVirtualClusterReadOnlyRequest
    ): SetVirtualClusterReadOnlyResponse {
        logger.info { "SetVirtualClusterReadOnly: ${request.virtualClusterId} = ${request.readOnly}" }
        val existing = store.get(request.virtualClusterId)
        if (existing != null) {
            val updated = existing.toBuilder()
                .setReadOnly(request.readOnly)
                .build()
            store.upsert(updated)
        }
        return SetVirtualClusterReadOnlyResponse.newBuilder()
            .setSuccess(existing != null)
            .build()
    }

    override suspend fun getFullConfig(
        request: GetFullConfigRequest
    ): GetFullConfigResponse {
        logger.info { "GetFullConfig requested" }
        return GetFullConfigResponse.newBuilder()
            .addAllVirtualClusters(store.getAll())
            .build()
    }

    override suspend fun getStatus(
        request: GetStatusRequest
    ): GetStatusResponse {
        return GetStatusResponse.newBuilder()
            .setStatus("healthy")
            .setActiveConnections(0) // TODO: Track actual connections
            .setVirtualClusterCount(store.count())
            .putVersionInfo("version", "0.1.0")
            .putVersionInfo("kotlin", System.getProperty("kotlin.version") ?: "unknown")
            .build()
    }

    override suspend fun listVirtualClusters(
        request: ListVirtualClustersRequest
    ): ListVirtualClustersResponse {
        return ListVirtualClustersResponse.newBuilder()
            .addAllVirtualClusters(store.getAll())
            .build()
    }
}
```

**Step 3: Create AdminServer**

```kotlin
// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/AdminServer.kt
package io.orbit.bifrost.admin

import io.grpc.Server
import io.grpc.ServerBuilder
import io.orbit.bifrost.config.VirtualClusterStore
import mu.KotlinLogging
import java.util.concurrent.TimeUnit

private val logger = KotlinLogging.logger {}

class AdminServer(
    private val port: Int,
    private val store: VirtualClusterStore
) {
    private var server: Server? = null

    fun start() {
        server = ServerBuilder.forPort(port)
            .addService(BifrostAdminServiceImpl(store))
            .build()
            .start()

        logger.info { "Admin gRPC server started on port $port" }

        Runtime.getRuntime().addShutdownHook(Thread {
            logger.info { "Shutting down admin server..." }
            stop()
        })
    }

    fun stop() {
        server?.shutdown()?.awaitTermination(30, TimeUnit.SECONDS)
    }

    fun blockUntilShutdown() {
        server?.awaitTermination()
    }
}
```

**Step 4: Update Application.kt**

```kotlin
// gateway/bifrost/src/main/kotlin/io/orbit/bifrost/Application.kt
package io.orbit.bifrost

import io.orbit.bifrost.admin.AdminServer
import io.orbit.bifrost.config.VirtualClusterStore
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

fun main(args: Array<String>) {
    val adminPort = System.getenv("BIFROST_ADMIN_PORT")?.toIntOrNull() ?: 50060

    logger.info { "Bifrost Gateway starting..." }

    val store = VirtualClusterStore()
    val adminServer = AdminServer(adminPort, store)

    adminServer.start()

    logger.info { "Bifrost Gateway started - Admin API on port $adminPort" }

    adminServer.blockUntilShutdown()
}
```

**Step 5: Build and test**

Run: `cd gateway/bifrost && ./gradlew build`
Expected: BUILD SUCCESSFUL

**Step 6: Commit**

```bash
git add gateway/bifrost/src/
git commit -m "feat(bifrost): implement gRPC Admin Service

- Add VirtualClusterStore for in-memory config management
- Implement BifrostAdminServiceImpl with all RPCs
- Add AdminServer for gRPC server lifecycle
- Wire up in Application.kt main function"
```

---

## Task 6: Create Server Actions for Applications

**Files:**
- Create: `orbit-www/src/app/actions/kafka-applications.ts`

**Step 1: Create server actions file**

```typescript
// orbit-www/src/app/actions/kafka-applications.ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { getServerUser } from '@/lib/auth/server'

export interface CreateApplicationInput {
  name: string
  slug: string
  description?: string
  workspaceId: string
}

export interface CreateApplicationResult {
  success: boolean
  applicationId?: string
  error?: string
}

export async function createApplication(
  input: CreateApplicationInput
): Promise<CreateApplicationResult> {
  try {
    const user = await getServerUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Check if slug already exists in workspace
    const existing = await payload.find({
      collection: 'kafka-applications',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { slug: { equals: input.slug } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return { success: false, error: 'An application with this slug already exists' }
    }

    // Create the application
    const application = await payload.create({
      collection: 'kafka-applications',
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description || '',
        workspace: input.workspaceId,
        status: 'active',
        createdBy: user.id,
      },
      overrideAccess: true,
    })

    // TODO: Trigger Temporal workflow to provision virtual clusters

    return { success: true, applicationId: application.id }
  } catch (error) {
    console.error('Error creating application:', error)
    return { success: false, error: 'Failed to create application' }
  }
}

export interface ListApplicationsInput {
  workspaceId: string
}

export interface ApplicationData {
  id: string
  name: string
  slug: string
  description?: string
  status: 'active' | 'decommissioning' | 'deleted'
  createdAt: string
  virtualClusters?: {
    id: string
    environment: 'dev' | 'stage' | 'prod'
    status: string
    advertisedHost: string
  }[]
}

export interface ListApplicationsResult {
  success: boolean
  applications?: ApplicationData[]
  error?: string
}

export async function listApplications(
  input: ListApplicationsInput
): Promise<ListApplicationsResult> {
  try {
    const user = await getServerUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Fetch applications
    const apps = await payload.find({
      collection: 'kafka-applications',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      sort: '-createdAt',
      limit: 100,
      overrideAccess: true,
    })

    // Fetch virtual clusters for each application
    const appIds = apps.docs.map((a) => a.id)
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { in: appIds },
      },
      limit: 1000,
      overrideAccess: true,
    })

    // Group virtual clusters by application
    const vcByApp = new Map<string, typeof virtualClusters.docs>()
    for (const vc of virtualClusters.docs) {
      const appId = typeof vc.application === 'string' ? vc.application : vc.application.id
      if (!vcByApp.has(appId)) {
        vcByApp.set(appId, [])
      }
      vcByApp.get(appId)!.push(vc)
    }

    const applications: ApplicationData[] = apps.docs.map((app) => ({
      id: app.id,
      name: app.name,
      slug: app.slug,
      description: app.description || undefined,
      status: app.status as ApplicationData['status'],
      createdAt: app.createdAt,
      virtualClusters: vcByApp.get(app.id)?.map((vc) => ({
        id: vc.id,
        environment: vc.environment as 'dev' | 'stage' | 'prod',
        status: vc.status,
        advertisedHost: vc.advertisedHost,
      })),
    }))

    return { success: true, applications }
  } catch (error) {
    console.error('Error listing applications:', error)
    return { success: false, error: 'Failed to list applications' }
  }
}

export interface GetApplicationInput {
  applicationId: string
}

export interface GetApplicationResult {
  success: boolean
  application?: ApplicationData
  error?: string
}

export async function getApplication(
  input: GetApplicationInput
): Promise<GetApplicationResult> {
  try {
    const user = await getServerUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const app = await payload.findByID({
      collection: 'kafka-applications',
      id: input.applicationId,
      depth: 1,
    })

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    // Fetch virtual clusters
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { equals: app.id },
      },
      limit: 10,
      overrideAccess: true,
    })

    const application: ApplicationData = {
      id: app.id,
      name: app.name,
      slug: app.slug,
      description: app.description || undefined,
      status: app.status as ApplicationData['status'],
      createdAt: app.createdAt,
      virtualClusters: virtualClusters.docs.map((vc) => ({
        id: vc.id,
        environment: vc.environment as 'dev' | 'stage' | 'prod',
        status: vc.status,
        advertisedHost: vc.advertisedHost,
      })),
    }

    return { success: true, application }
  } catch (error) {
    console.error('Error getting application:', error)
    return { success: false, error: 'Failed to get application' }
  }
}
```

**Step 2: Verify the file compiles**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-applications.ts
git commit -m "feat(actions): add Kafka application server actions

- createApplication: creates app with workspace validation
- listApplications: fetches apps with virtual cluster info
- getApplication: fetches single app with details
- Workspace membership checks on all actions"
```

---

## Task 7: Create Application Creation UI

**Files:**
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/page.tsx`
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/applications-client.tsx`
- Create: `orbit-www/src/components/features/kafka/CreateApplicationDialog.tsx`

**Step 1: Create the page server component**

```typescript
// orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect, notFound } from 'next/navigation'
import { getServerUser } from '@/lib/auth/server'
import { ApplicationsClient } from './applications-client'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function KafkaApplicationsPage({ params }: PageProps) {
  const { slug } = await params
  const user = await getServerUser()

  if (!user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaceResult.docs.length === 0) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  return (
    <div className="container mx-auto py-6">
      <ApplicationsClient
        workspaceId={workspace.id}
        workspaceSlug={slug}
      />
    </div>
  )
}
```

**Step 2: Create the client component**

```typescript
// orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/applications-client.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, RefreshCw, MoreHorizontal, Server, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { listApplications, ApplicationData } from '@/app/actions/kafka-applications'
import { CreateApplicationDialog } from '@/components/features/kafka/CreateApplicationDialog'

interface ApplicationsClientProps {
  workspaceId: string
  workspaceSlug: string
}

const statusConfig = {
  active: {
    icon: CheckCircle2,
    label: 'Active',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  decommissioning: {
    icon: Clock,
    label: 'Decommissioning',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  deleted: {
    icon: AlertCircle,
    label: 'Deleted',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
}

const envColors: Record<string, string> = {
  dev: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  stage: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  prod: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
}

export function ApplicationsClient({ workspaceId, workspaceSlug }: ApplicationsClientProps) {
  const [applications, setApplications] = useState<ApplicationData[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const loadApplications = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listApplications({ workspaceId })
      if (result.success && result.applications) {
        setApplications(result.applications)
      } else {
        toast.error(result.error || 'Failed to load applications')
      }
    } catch (error) {
      toast.error('Failed to load applications')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadApplications()
  }, [loadApplications])

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    loadApplications()
    toast.success('Application created successfully')
  }

  const renderStatusBadge = (status: ApplicationData['status']) => {
    const config = statusConfig[status]
    const StatusIcon = config.icon
    return (
      <Badge variant="secondary" className={config.className}>
        <StatusIcon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Kafka Applications</h1>
          <p className="text-muted-foreground">
            Manage your Kafka applications and virtual clusters
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadApplications} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create Application
          </Button>
        </div>
      </div>

      {applications.length === 0 && !loading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Server className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Applications Yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Kafka applications provide isolated virtual clusters for your services.
              Each application gets dev, stage, and prod environments.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Your First Application
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>
              {applications.length} application{applications.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Virtual Clusters</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell>
                      <div>
                        <Link
                          href={`/workspaces/${workspaceSlug}/kafka/applications/${app.slug}`}
                          className="font-medium hover:underline"
                        >
                          {app.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">{app.slug}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {app.virtualClusters?.map((vc) => (
                          <Badge
                            key={vc.id}
                            variant="secondary"
                            className={envColors[vc.environment]}
                          >
                            {vc.environment.toUpperCase()}
                          </Badge>
                        )) || (
                          <span className="text-sm text-muted-foreground">Provisioning...</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{renderStatusBadge(app.status)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/workspaces/${workspaceSlug}/kafka/applications/${app.slug}`}>
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/workspaces/${workspaceSlug}/kafka/applications/${app.slug}/settings`}>
                              Settings
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateApplicationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}
```

**Step 3: Create the dialog component**

```typescript
// orbit-www/src/components/features/kafka/CreateApplicationDialog.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createApplication } from '@/app/actions/kafka-applications'

interface CreateApplicationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onSuccess: () => void
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 63)
}

export function CreateApplicationDialog({
  open,
  onOpenChange,
  workspaceId,
  onSuccess,
}: CreateApplicationDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugManuallyEdited) {
      setSlug(slugify(value))
    }
  }

  const handleSlugChange = (value: string) => {
    setSlug(value)
    setSlugManuallyEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!slug.trim()) {
      toast.error('Slug is required')
      return
    }
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      toast.error('Slug must start with a letter and contain only lowercase letters, numbers, and hyphens')
      return
    }

    setLoading(true)
    try {
      const result = await createApplication({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        workspaceId,
      })

      if (result.success) {
        setName('')
        setSlug('')
        setDescription('')
        setSlugManuallyEdited(false)
        onSuccess()
      } else {
        toast.error(result.error || 'Failed to create application')
      }
    } catch (error) {
      toast.error('Failed to create application')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Kafka Application</DialogTitle>
          <DialogDescription>
            Create a new Kafka application. This will provision three virtual clusters
            for dev, stage, and prod environments.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Payments Service"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              placeholder="e.g., payments-service"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground">
              Used in hostnames: <code>{slug || 'your-app'}.dev.kafka.orbit.io</code>
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What does this application do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 4: Verify the components compile**

Run: `cd orbit-www && bunx tsc --noEmit`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/kafka/applications/
git add orbit-www/src/components/features/kafka/CreateApplicationDialog.tsx
git commit -m "feat(ui): add Kafka applications list and create dialog

- Applications list page with status badges
- Virtual cluster environment indicators
- Create dialog with name/slug/description
- Auto-slug generation from name
- Shows hostname preview for slug"
```

---

## Task 8: Create VirtualClusterProvisionWorkflow (Temporal)

**Files:**
- Create: `temporal-workflows/internal/workflows/virtual_cluster_workflow.go`
- Create: `temporal-workflows/internal/activities/virtual_cluster_activities.go`
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Create workflow definition**

```go
// temporal-workflows/internal/workflows/virtual_cluster_workflow.go
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// VirtualClusterProvisionInput contains the input for provisioning virtual clusters
type VirtualClusterProvisionInput struct {
	ApplicationID   string `json:"applicationId"`
	ApplicationSlug string `json:"applicationSlug"`
	WorkspaceID     string `json:"workspaceId"`
	WorkspaceSlug   string `json:"workspaceSlug"`
}

// VirtualClusterProvisionResult contains the result of provisioning
type VirtualClusterProvisionResult struct {
	Success         bool     `json:"success"`
	VirtualClusters []string `json:"virtualClusterIds"`
	Error           string   `json:"error,omitempty"`
}

// VirtualClusterProvisionWorkflow provisions three virtual clusters (dev, stage, prod)
// for a newly created Kafka application
func VirtualClusterProvisionWorkflow(ctx workflow.Context, input VirtualClusterProvisionInput) (*VirtualClusterProvisionResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting VirtualClusterProvisionWorkflow", "applicationId", input.ApplicationID)

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

	environments := []string{"dev", "stage", "prod"}
	var virtualClusterIds []string

	for _, env := range environments {
		// Step 1: Get environment mapping to find physical cluster
		var mappingResult GetEnvironmentMappingResult
		err := workflow.ExecuteActivity(ctx, ActivityGetEnvironmentMapping, GetEnvironmentMappingInput{
			Environment: env,
		}).Get(ctx, &mappingResult)
		if err != nil {
			logger.Error("Failed to get environment mapping", "env", env, "error", err)
			return &VirtualClusterProvisionResult{
				Success: false,
				Error:   fmt.Sprintf("Failed to get environment mapping for %s: %v", env, err),
			}, nil
		}

		if mappingResult.ClusterID == "" {
			logger.Warn("No cluster mapped for environment, skipping", "env", env)
			continue
		}

		// Step 2: Create virtual cluster in Payload
		var createResult CreateVirtualClusterResult
		err = workflow.ExecuteActivity(ctx, ActivityCreateVirtualCluster, CreateVirtualClusterInput{
			ApplicationID:     input.ApplicationID,
			ApplicationSlug:   input.ApplicationSlug,
			WorkspaceSlug:     input.WorkspaceSlug,
			Environment:       env,
			PhysicalClusterID: mappingResult.ClusterID,
			BootstrapServers:  mappingResult.BootstrapServers,
		}).Get(ctx, &createResult)
		if err != nil {
			logger.Error("Failed to create virtual cluster", "env", env, "error", err)
			return &VirtualClusterProvisionResult{
				Success: false,
				Error:   fmt.Sprintf("Failed to create virtual cluster for %s: %v", env, err),
			}, nil
		}

		virtualClusterIds = append(virtualClusterIds, createResult.VirtualClusterID)

		// Step 3: Push config to Bifrost gateway
		var pushResult PushToBifrostResult
		err = workflow.ExecuteActivity(ctx, ActivityPushToBifrost, PushToBifrostInput{
			VirtualClusterID:  createResult.VirtualClusterID,
			ApplicationID:     input.ApplicationID,
			ApplicationSlug:   input.ApplicationSlug,
			WorkspaceSlug:     input.WorkspaceSlug,
			Environment:       env,
			TopicPrefix:       createResult.TopicPrefix,
			GroupPrefix:       createResult.GroupPrefix,
			AdvertisedHost:    createResult.AdvertisedHost,
			BootstrapServers:  mappingResult.BootstrapServers,
		}).Get(ctx, &pushResult)
		if err != nil {
			logger.Error("Failed to push config to Bifrost", "env", env, "error", err)
			// Don't fail the workflow, just log the error
			// The virtual cluster is created, Bifrost sync can retry
		}

		// Step 4: Update virtual cluster status to active
		err = workflow.ExecuteActivity(ctx, ActivityUpdateVirtualClusterStatus, UpdateVirtualClusterStatusInput{
			VirtualClusterID: createResult.VirtualClusterID,
			Status:           "active",
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to update virtual cluster status", "env", env, "error", err)
		}

		logger.Info("Provisioned virtual cluster", "env", env, "id", createResult.VirtualClusterID)
	}

	logger.Info("VirtualClusterProvisionWorkflow completed", "clusters", len(virtualClusterIds))
	return &VirtualClusterProvisionResult{
		Success:         true,
		VirtualClusters: virtualClusterIds,
	}, nil
}
```

**Step 2: Create activity definitions**

```go
// temporal-workflows/internal/activities/virtual_cluster_activities.go
package activities

import (
	"context"
	"fmt"
	"log/slog"
)

// Activity names
const (
	ActivityGetEnvironmentMapping       = "GetEnvironmentMapping"
	ActivityCreateVirtualCluster        = "CreateVirtualCluster"
	ActivityPushToBifrost               = "PushToBifrost"
	ActivityUpdateVirtualClusterStatus  = "UpdateVirtualClusterStatus"
)

// GetEnvironmentMappingInput is the input for getting environment mapping
type GetEnvironmentMappingInput struct {
	Environment string `json:"environment"`
}

// GetEnvironmentMappingResult is the result of getting environment mapping
type GetEnvironmentMappingResult struct {
	ClusterID        string `json:"clusterId"`
	BootstrapServers string `json:"bootstrapServers"`
}

// CreateVirtualClusterInput is the input for creating a virtual cluster
type CreateVirtualClusterInput struct {
	ApplicationID     string `json:"applicationId"`
	ApplicationSlug   string `json:"applicationSlug"`
	WorkspaceSlug     string `json:"workspaceSlug"`
	Environment       string `json:"environment"`
	PhysicalClusterID string `json:"physicalClusterId"`
	BootstrapServers  string `json:"bootstrapServers"`
}

// CreateVirtualClusterResult is the result of creating a virtual cluster
type CreateVirtualClusterResult struct {
	VirtualClusterID string `json:"virtualClusterId"`
	TopicPrefix      string `json:"topicPrefix"`
	GroupPrefix      string `json:"groupPrefix"`
	AdvertisedHost   string `json:"advertisedHost"`
}

// PushToBifrostInput is the input for pushing config to Bifrost
type PushToBifrostInput struct {
	VirtualClusterID string `json:"virtualClusterId"`
	ApplicationID    string `json:"applicationId"`
	ApplicationSlug  string `json:"applicationSlug"`
	WorkspaceSlug    string `json:"workspaceSlug"`
	Environment      string `json:"environment"`
	TopicPrefix      string `json:"topicPrefix"`
	GroupPrefix      string `json:"groupPrefix"`
	AdvertisedHost   string `json:"advertisedHost"`
	BootstrapServers string `json:"bootstrapServers"`
}

// PushToBifrostResult is the result of pushing config to Bifrost
type PushToBifrostResult struct {
	Success bool `json:"success"`
}

// UpdateVirtualClusterStatusInput is the input for updating virtual cluster status
type UpdateVirtualClusterStatusInput struct {
	VirtualClusterID string `json:"virtualClusterId"`
	Status           string `json:"status"`
}

// VirtualClusterActivities contains activities for virtual cluster provisioning
type VirtualClusterActivities struct {
	payloadURL  string
	bifrostURL  string
	logger      *slog.Logger
}

// NewVirtualClusterActivities creates a new VirtualClusterActivities
func NewVirtualClusterActivities(payloadURL, bifrostURL string, logger *slog.Logger) *VirtualClusterActivities {
	return &VirtualClusterActivities{
		payloadURL: payloadURL,
		bifrostURL: bifrostURL,
		logger:     logger,
	}
}

// GetEnvironmentMapping gets the cluster mapping for an environment
func (a *VirtualClusterActivities) GetEnvironmentMapping(ctx context.Context, input GetEnvironmentMappingInput) (*GetEnvironmentMappingResult, error) {
	a.logger.Info("GetEnvironmentMapping", "environment", input.Environment)

	// TODO: Call Payload API to get environment mapping
	// For now, return mock data
	return &GetEnvironmentMappingResult{
		ClusterID:        "cluster-" + input.Environment,
		BootstrapServers: "localhost:19092", // Redpanda in docker-compose
	}, nil
}

// CreateVirtualCluster creates a virtual cluster record in Payload
func (a *VirtualClusterActivities) CreateVirtualCluster(ctx context.Context, input CreateVirtualClusterInput) (*CreateVirtualClusterResult, error) {
	a.logger.Info("CreateVirtualCluster",
		"app", input.ApplicationSlug,
		"env", input.Environment)

	// Generate prefixes based on workspace and application
	prefix := fmt.Sprintf("%s-%s-%s-", input.WorkspaceSlug, input.ApplicationSlug, input.Environment)
	advertisedHost := fmt.Sprintf("%s.%s.kafka.orbit.io", input.ApplicationSlug, input.Environment)

	// TODO: Call Payload API to create virtual cluster
	// For now, return mock data
	return &CreateVirtualClusterResult{
		VirtualClusterID: fmt.Sprintf("vc-%s-%s", input.ApplicationSlug, input.Environment),
		TopicPrefix:      prefix,
		GroupPrefix:      prefix,
		AdvertisedHost:   advertisedHost,
	}, nil
}

// PushToBifrost pushes virtual cluster config to Bifrost gateway
func (a *VirtualClusterActivities) PushToBifrost(ctx context.Context, input PushToBifrostInput) (*PushToBifrostResult, error) {
	a.logger.Info("PushToBifrost",
		"virtualCluster", input.VirtualClusterID,
		"advertisedHost", input.AdvertisedHost)

	// TODO: Call Bifrost gRPC Admin API to upsert virtual cluster
	// For now, return success
	return &PushToBifrostResult{Success: true}, nil
}

// UpdateVirtualClusterStatus updates the status of a virtual cluster
func (a *VirtualClusterActivities) UpdateVirtualClusterStatus(ctx context.Context, input UpdateVirtualClusterStatusInput) error {
	a.logger.Info("UpdateVirtualClusterStatus",
		"virtualCluster", input.VirtualClusterID,
		"status", input.Status)

	// TODO: Call Payload API to update status
	return nil
}
```

**Step 3: Register workflow and activities in worker**

Add to `temporal-workflows/cmd/worker/main.go`:

```go
// Import
import "github.com/drewpayment/orbit/temporal-workflows/internal/activities"

// In main(), after other workflow registrations:
w.RegisterWorkflow(workflows.VirtualClusterProvisionWorkflow)

// Create and register activities
vcActivities := activities.NewVirtualClusterActivities(
    orbitAPIURL,
    os.Getenv("BIFROST_ADMIN_URL"),
    logger,
)
w.RegisterActivity(vcActivities.GetEnvironmentMapping)
w.RegisterActivity(vcActivities.CreateVirtualCluster)
w.RegisterActivity(vcActivities.PushToBifrost)
w.RegisterActivity(vcActivities.UpdateVirtualClusterStatus)
```

**Step 4: Verify the code compiles**

Run: `cd temporal-workflows && go build ./...`
Expected: Build successful

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/virtual_cluster_workflow.go
git add temporal-workflows/internal/activities/virtual_cluster_activities.go
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat(temporal): add VirtualClusterProvisionWorkflow

- Provisions dev/stage/prod virtual clusters for new applications
- Activities for environment mapping, Payload CRUD, Bifrost sync
- Generates topic/group prefixes and advertised hostnames
- Updates status to active after successful provisioning"
```

---

## Task 9: Add Bifrost to Docker Compose

**Files:**
- Modify: `docker-compose.yml`
- Create: `gateway/bifrost/Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
# gateway/bifrost/Dockerfile
FROM gradle:8.5-jdk21 AS builder

WORKDIR /app
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY src ./src

RUN gradle build --no-daemon -x test

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar

ENV BIFROST_ADMIN_PORT=50060

EXPOSE 9092 50060

ENTRYPOINT ["java", "-jar", "app.jar"]
```

**Step 2: Add Bifrost service to docker-compose.yml**

Add to `docker-compose.yml` services section:

```yaml
  bifrost-dev:
    build:
      context: ./gateway/bifrost
      dockerfile: Dockerfile
    container_name: orbit-bifrost-dev
    ports:
      - "9192:9092"  # Kafka protocol
      - "50060:50060"  # Admin gRPC
    environment:
      - BIFROST_ADMIN_PORT=50060
      - BIFROST_KAFKA_PORT=9092
      - BIFROST_ENVIRONMENT=dev
    depends_on:
      - redpanda
    networks:
      - orbit-network
    restart: unless-stopped
```

**Step 3: Verify docker-compose is valid**

Run: `docker-compose config`
Expected: Valid YAML output without errors

**Step 4: Commit**

```bash
git add gateway/bifrost/Dockerfile
git add docker-compose.yml
git commit -m "feat(docker): add Bifrost gateway to docker-compose

- Multi-stage Dockerfile for Kotlin/Gradle build
- Bifrost-dev service on ports 9192 (Kafka) and 50060 (Admin)
- Connected to orbit-network with Redpanda dependency"
```

---

## Task 10: Create Integration Test

**Files:**
- Create: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/integration/AdminServiceIntegrationTest.kt`

**Step 1: Create integration test**

```kotlin
// gateway/bifrost/src/test/kotlin/io/orbit/bifrost/integration/AdminServiceIntegrationTest.kt
package io.orbit.bifrost.integration

import io.grpc.ManagedChannelBuilder
import io.orbit.bifrost.admin.AdminServer
import io.orbit.bifrost.config.VirtualClusterStore
import io.orbit.bifrost.proto.*
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import java.util.concurrent.TimeUnit

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AdminServiceIntegrationTest {

    private lateinit var store: VirtualClusterStore
    private lateinit var server: AdminServer
    private lateinit var stub: BifrostAdminServiceGrpcKt.BifrostAdminServiceCoroutineStub

    private val port = 50099

    @BeforeAll
    fun setup() {
        store = VirtualClusterStore()
        server = AdminServer(port, store)
        server.start()

        val channel = ManagedChannelBuilder.forAddress("localhost", port)
            .usePlaintext()
            .build()
        stub = BifrostAdminServiceGrpcKt.BifrostAdminServiceCoroutineStub(channel)
    }

    @AfterAll
    fun teardown() {
        server.stop()
    }

    @BeforeEach
    fun reset() {
        store.clear()
    }

    @Test
    fun `should upsert and retrieve virtual cluster`() = runBlocking {
        val config = VirtualClusterConfig.newBuilder()
            .setId("vc-test-1")
            .setApplicationId("app-1")
            .setApplicationSlug("payments")
            .setWorkspaceSlug("acme")
            .setEnvironment("dev")
            .setTopicPrefix("acme-payments-dev-")
            .setGroupPrefix("acme-payments-dev-")
            .setAdvertisedHost("payments.dev.kafka.orbit.io")
            .setAdvertisedPort(9092)
            .setPhysicalBootstrapServers("localhost:9092")
            .setReadOnly(false)
            .build()

        // Upsert
        val upsertResponse = stub.upsertVirtualCluster(
            UpsertVirtualClusterRequest.newBuilder().setConfig(config).build()
        )
        assertTrue(upsertResponse.success)

        // List
        val listResponse = stub.listVirtualClusters(ListVirtualClustersRequest.getDefaultInstance())
        assertEquals(1, listResponse.virtualClustersCount)
        assertEquals("vc-test-1", listResponse.getVirtualClusters(0).id)
    }

    @Test
    fun `should delete virtual cluster`() = runBlocking {
        val config = VirtualClusterConfig.newBuilder()
            .setId("vc-delete-test")
            .setApplicationId("app-1")
            .setEnvironment("dev")
            .setAdvertisedHost("test.dev.kafka.orbit.io")
            .build()

        stub.upsertVirtualCluster(
            UpsertVirtualClusterRequest.newBuilder().setConfig(config).build()
        )

        val deleteResponse = stub.deleteVirtualCluster(
            DeleteVirtualClusterRequest.newBuilder()
                .setVirtualClusterId("vc-delete-test")
                .build()
        )
        assertTrue(deleteResponse.success)

        val listResponse = stub.listVirtualClusters(ListVirtualClustersRequest.getDefaultInstance())
        assertEquals(0, listResponse.virtualClustersCount)
    }

    @Test
    fun `should report healthy status`() = runBlocking {
        val response = stub.getStatus(GetStatusRequest.getDefaultInstance())
        assertEquals("healthy", response.status)
        assertEquals(0, response.virtualClusterCount)
    }

    @Test
    fun `should get full config on startup`() = runBlocking {
        // Add some clusters
        for (env in listOf("dev", "stage", "prod")) {
            val config = VirtualClusterConfig.newBuilder()
                .setId("vc-$env")
                .setEnvironment(env)
                .build()
            stub.upsertVirtualCluster(
                UpsertVirtualClusterRequest.newBuilder().setConfig(config).build()
            )
        }

        val fullConfig = stub.getFullConfig(GetFullConfigRequest.getDefaultInstance())
        assertEquals(3, fullConfig.virtualClustersCount)
    }
}
```

**Step 2: Run the integration test**

Run: `cd gateway/bifrost && ./gradlew test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add gateway/bifrost/src/test/
git commit -m "test(bifrost): add Admin Service integration tests

- Test upsert and list virtual clusters
- Test delete virtual cluster
- Test health status endpoint
- Test full config retrieval"
```

---

## Task 11: End-to-End Verification

**Step 1: Start the development environment**

Run: `make dev`
Expected: All services start including Bifrost

**Step 2: Create a test application via UI**

1. Open `http://localhost:3000`
2. Navigate to a workspace
3. Go to Kafka > Applications
4. Click "Create Application"
5. Enter name: "Test Service", slug: "test-service"
6. Click Create

Expected: Application created, redirected to applications list

**Step 3: Verify virtual clusters were created**

Check Payload admin: `http://localhost:3000/admin/collections/kafka-virtual-clusters`
Expected: Three virtual clusters (dev, stage, prod) for the application

**Step 4: Verify Bifrost received config**

Run: `grpcurl -plaintext localhost:50060 idp.gateway.v1.BifrostAdminService/ListVirtualClusters`
Expected: Returns virtual cluster configs

**Step 5: Document any issues found**

Create issues for any bugs discovered during verification.

---

## Summary

This Phase 1 implementation plan covers:

1. **Gateway Setup** - Kotlin/Gradle project with Kroxylicious dependencies
2. **Proto Definitions** - BifrostAdminService with virtual cluster management
3. **Payload Collections** - KafkaApplications and KafkaVirtualClusters
4. **gRPC Admin Server** - In-memory virtual cluster store with admin API
5. **Server Actions** - Create/list/get applications with workspace validation
6. **UI Components** - Applications list and create dialog
7. **Temporal Workflow** - VirtualClusterProvisionWorkflow for auto-provisioning
8. **Docker Integration** - Bifrost service in docker-compose
9. **Integration Tests** - Admin service verification
10. **E2E Verification** - Full flow testing

---

**Plan complete and saved to `docs/plans/2026-01-03-bifrost-phase1-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
