# Phase 5: Topic Sharing & Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable cross-application topic sharing with a discoverable catalog, approval workflows, and gateway-level ACL enforcement.

**Architecture:** Topics have visibility tiers (private/workspace/discoverable/public). Users browse a cross-workspace catalog, request access, owners approve, and a Temporal workflow immediately syncs ACLs to Bifrost gateway. A new `TopicACLFilter` in the gateway enforces cross-tenant access.

**Tech Stack:** Kotlin (Bifrost gateway), Go (Temporal workflows), TypeScript/React (Next.js UI), Payload CMS, gRPC/protobuf

---

## Prerequisites

- Phases 1-3 complete (gateway, auth, policies)
- Phase 4 complete (quotas & approvals) - provides notification patterns
- `KafkaTopicShares` and `KafkaTopicSharePolicies` collections exist

---

## Task 1: Add ACL Proto Messages to Gateway

**Files:**
- Modify: `proto/idp/gateway/v1/gateway.proto`

**Step 1: Add ACL messages and RPCs**

Add after line 45 (after existing RPCs):

```protobuf
  // Topic ACL management (for cross-application sharing)
  rpc UpsertTopicACL(UpsertTopicACLRequest) returns (UpsertTopicACLResponse);
  rpc RevokeTopicACL(RevokeTopicACLRequest) returns (RevokeTopicACLResponse);
  rpc ListTopicACLs(ListTopicACLsRequest) returns (ListTopicACLsResponse);
```

Add after PolicyConfig messages (around line 200):

```protobuf
// ============================================================================
// Topic ACL Messages (Cross-Application Sharing)
// ============================================================================

message TopicACLEntry {
  string id = 1;                          // Share ID from Orbit
  string credential_id = 2;               // Service account granted access
  string topic_physical_name = 3;         // Full physical topic name
  repeated string permissions = 4;        // "read", "write"
  google.protobuf.Timestamp expires_at = 5;
}

message UpsertTopicACLRequest {
  TopicACLEntry entry = 1;
}

message UpsertTopicACLResponse {
  bool success = 1;
}

message RevokeTopicACLRequest {
  string acl_id = 1;
}

message RevokeTopicACLResponse {
  bool success = 1;
}

message ListTopicACLsRequest {
  string credential_id = 1;  // Optional: filter by credential
}

message ListTopicACLsResponse {
  repeated TopicACLEntry entries = 1;
}
```

Also add `repeated TopicACLEntry topic_acls = 5;` to `GetFullConfigResponse`.

**Step 2: Generate proto code**

Run: `make proto-gen`

Expected: Go code generated to `proto/gen/go/idp/gateway/v1/`

**Step 3: Commit**

```bash
git add proto/idp/gateway/v1/gateway.proto
git commit -m "feat(proto): add TopicACL messages for cross-app sharing"
```

---

## Task 2: Implement ACLStore in Bifrost Gateway

**Files:**
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/ACLEntry.kt`
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/ACLStore.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/acl/ACLStoreTest.kt`

**Step 1: Write the failing test**

Create `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/acl/ACLStoreTest.kt`:

```kotlin
package io.orbit.bifrost.acl

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.BeforeEach
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertNull
import java.time.Instant

class ACLStoreTest {
    private lateinit var store: ACLStore

    @BeforeEach
    fun setup() {
        store = ACLStore()
    }

    @Test
    fun `upsert and retrieve by credential`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)

        val results = store.getByCredential("cred-1")
        assertEquals(1, results.size)
        assertEquals("share-1", results[0].id)
    }

    @Test
    fun `check permission for topic`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)

        assertTrue(store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
        assertTrue(!store.hasPermission("cred-1", "acme-payments-prod-orders", "write"))
        assertTrue(!store.hasPermission("cred-1", "other-topic", "read"))
    }

    @Test
    fun `expired ACL returns false`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = Instant.now().minusSeconds(3600) // Expired 1 hour ago
        )
        store.upsert(entry)

        assertTrue(!store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
    }

    @Test
    fun `revoke removes ACL`() {
        val entry = ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "acme-payments-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        )
        store.upsert(entry)
        store.revoke("share-1")

        assertTrue(!store.hasPermission("cred-1", "acme-payments-prod-orders", "read"))
        assertEquals(0, store.getByCredential("cred-1").size)
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.acl.ACLStoreTest"`

Expected: FAIL - class not found

**Step 3: Create ACLEntry data class**

Create `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/ACLEntry.kt`:

```kotlin
package io.orbit.bifrost.acl

import java.time.Instant

data class ACLEntry(
    val id: String,
    val credentialId: String,
    val topicPhysicalName: String,
    val permissions: Set<String>,
    val expiresAt: Instant?
) {
    fun isExpired(): Boolean = expiresAt?.isBefore(Instant.now()) ?: false
    fun hasPermission(permission: String): Boolean = !isExpired() && permissions.contains(permission)
}
```

**Step 4: Create ACLStore**

Create `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/ACLStore.kt`:

```kotlin
package io.orbit.bifrost.acl

import java.util.concurrent.ConcurrentHashMap

class ACLStore {
    private val byId = ConcurrentHashMap<String, ACLEntry>()
    private val byCredential = ConcurrentHashMap<String, MutableSet<String>>()
    private val byTopic = ConcurrentHashMap<String, MutableSet<String>>()

    @Synchronized
    fun upsert(entry: ACLEntry) {
        // Remove old entry if exists
        byId[entry.id]?.let { old ->
            byCredential[old.credentialId]?.remove(old.id)
            byTopic[old.topicPhysicalName]?.remove(old.id)
        }

        // Add new entry
        byId[entry.id] = entry
        byCredential.getOrPut(entry.credentialId) { mutableSetOf() }.add(entry.id)
        byTopic.getOrPut(entry.topicPhysicalName) { mutableSetOf() }.add(entry.id)
    }

    @Synchronized
    fun revoke(aclId: String): Boolean {
        val entry = byId.remove(aclId) ?: return false
        byCredential[entry.credentialId]?.remove(aclId)
        byTopic[entry.topicPhysicalName]?.remove(aclId)
        return true
    }

    fun getById(id: String): ACLEntry? = byId[id]

    fun getByCredential(credentialId: String): List<ACLEntry> {
        return byCredential[credentialId]
            ?.mapNotNull { byId[it] }
            ?.filter { !it.isExpired() }
            ?: emptyList()
    }

    fun getByTopic(topicPhysicalName: String): List<ACLEntry> {
        return byTopic[topicPhysicalName]
            ?.mapNotNull { byId[it] }
            ?.filter { !it.isExpired() }
            ?: emptyList()
    }

    fun hasPermission(credentialId: String, topicPhysicalName: String, permission: String): Boolean {
        val aclIds = byCredential[credentialId] ?: return false
        return aclIds.any { aclId ->
            byId[aclId]?.let { entry ->
                entry.topicPhysicalName == topicPhysicalName && entry.hasPermission(permission)
            } ?: false
        }
    }

    fun getAll(): List<ACLEntry> = byId.values.toList()
    fun count(): Int = byId.size
    fun clear() {
        byId.clear()
        byCredential.clear()
        byTopic.clear()
    }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.acl.ACLStoreTest"`

Expected: PASS

**Step 6: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/acl/
git add gateway/bifrost/src/test/kotlin/io/orbit/bifrost/acl/
git commit -m "feat(bifrost): add ACLStore for cross-app topic sharing"
```

---

## Task 3: Implement TopicACLFilter

**Files:**
- Create: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/TopicACLFilter.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/TopicACLFilterTest.kt`

**Step 1: Write the failing test**

Create `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/TopicACLFilterTest.kt`:

```kotlin
package io.orbit.bifrost.filter

import io.orbit.bifrost.acl.ACLEntry
import io.orbit.bifrost.acl.ACLStore
import io.orbit.bifrost.config.VirtualClusterConfig
import kotlinx.coroutines.runBlocking
import org.apache.kafka.common.message.FetchRequestData
import org.apache.kafka.common.message.ProduceRequestData
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.FetchRequest
import org.apache.kafka.common.requests.ProduceRequest
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue

class TopicACLFilterTest {
    private lateinit var aclStore: ACLStore
    private lateinit var filter: TopicACLFilter

    private val virtualCluster = VirtualClusterConfig(
        id = "vc-1",
        applicationId = "app-1",
        environment = "prod",
        topicPrefix = "acme-payments-prod-",
        groupPrefix = "acme-payments-prod-",
        transactionIdPrefix = "acme-payments-prod-",
        advertisedHost = "payments.prod.kafka.orbit.io",
        advertisedPort = 9092,
        physicalBootstrapServers = "kafka:9092",
        readOnly = false
    )

    @BeforeEach
    fun setup() {
        aclStore = ACLStore()
        filter = TopicACLFilter(aclStore)
    }

    @Test
    fun `allows access to own topics without ACL`() = runBlocking {
        val context = FilterContext(
            virtualCluster = virtualCluster,
            credentialId = "cred-1",
            username = "acme-payments-prod-producer",
            permissions = setOf("write"),
            isAuthenticated = true
        )

        // Topic within own prefix - should pass without ACL
        val fetchData = FetchRequestData()
        fetchData.topics().add(FetchRequestData.FetchTopic().setTopic("acme-payments-prod-orders"))
        val request = FetchRequest.Builder.forConsumer(0, 0, mapOf()).build()

        val result = filter.onRequest(context, ApiKeys.FETCH.id, request)
        assertTrue(result is FilterResult.Pass)
    }

    @Test
    fun `blocks access to foreign topic without ACL`() = runBlocking {
        val context = FilterContext(
            virtualCluster = virtualCluster,
            credentialId = "cred-1",
            username = "acme-payments-prod-consumer",
            permissions = setOf("read"),
            isAuthenticated = true
        )

        // Topic from different virtual cluster - should block
        val fetchData = FetchRequestData()
        fetchData.topics().add(FetchRequestData.FetchTopic().setTopic("other-workspace-prod-orders"))
        val request = FetchRequest.Builder.forConsumer(0, 0, mapOf()).build()

        val result = filter.onRequest(context, ApiKeys.FETCH.id, request)
        assertTrue(result is FilterResult.Reject)
    }

    @Test
    fun `allows access to foreign topic with valid ACL`() = runBlocking {
        // Grant ACL for foreign topic
        aclStore.upsert(ACLEntry(
            id = "share-1",
            credentialId = "cred-1",
            topicPhysicalName = "other-workspace-prod-orders",
            permissions = setOf("read"),
            expiresAt = null
        ))

        val context = FilterContext(
            virtualCluster = virtualCluster,
            credentialId = "cred-1",
            username = "acme-payments-prod-consumer",
            permissions = setOf("read"),
            isAuthenticated = true
        )

        val fetchData = FetchRequestData()
        fetchData.topics().add(FetchRequestData.FetchTopic().setTopic("other-workspace-prod-orders"))
        val request = FetchRequest.Builder.forConsumer(0, 0, mapOf()).build()

        val result = filter.onRequest(context, ApiKeys.FETCH.id, request)
        assertTrue(result is FilterResult.Pass)
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.filter.TopicACLFilterTest"`

Expected: FAIL - class not found

**Step 3: Implement TopicACLFilter**

Create `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/TopicACLFilter.kt`:

```kotlin
package io.orbit.bifrost.filter

import io.orbit.bifrost.acl.ACLStore
import org.apache.kafka.common.protocol.ApiKeys
import org.apache.kafka.common.requests.*

/**
 * Filter that enforces cross-application topic ACLs.
 *
 * Topics within the credential's own prefix pass through.
 * Topics outside the prefix require an explicit ACL grant.
 *
 * Order: 15 (after TopicRewriteFilter which is 10)
 */
class TopicACLFilter(
    private val aclStore: ACLStore
) : BifrostFilter {

    override val name: String = "TopicACLFilter"
    override val order: Int = 15

    override suspend fun onRequest(
        context: FilterContext,
        apiKey: Short,
        request: AbstractRequest
    ): FilterResult<AbstractRequest> {
        // Skip if not authenticated
        if (!context.isAuthenticated || context.credentialId == null) {
            return FilterResult.Pass(request)
        }

        val credentialId = context.credentialId
        val ownPrefix = context.topicPrefix

        return when (apiKey.toInt()) {
            ApiKeys.FETCH.id.toInt() -> checkFetchRequest(request as FetchRequest, credentialId, ownPrefix, context)
            ApiKeys.PRODUCE.id.toInt() -> checkProduceRequest(request as ProduceRequest, credentialId, ownPrefix, context)
            ApiKeys.LIST_OFFSETS.id.toInt() -> checkListOffsetsRequest(request as ListOffsetsRequest, credentialId, ownPrefix)
            ApiKeys.METADATA.id.toInt() -> FilterResult.Pass(request) // Metadata is filtered elsewhere
            else -> FilterResult.Pass(request)
        }
    }

    override suspend fun onResponse(
        context: FilterContext,
        apiKey: Short,
        response: AbstractResponse
    ): FilterResult<AbstractResponse> {
        return FilterResult.Pass(response)
    }

    private fun checkFetchRequest(
        request: FetchRequest,
        credentialId: String,
        ownPrefix: String,
        context: FilterContext
    ): FilterResult<AbstractRequest> {
        val topics = request.data().topics().map { it.topic() }
        return checkTopicAccess(topics, credentialId, ownPrefix, "read", context)
    }

    private fun checkProduceRequest(
        request: ProduceRequest,
        credentialId: String,
        ownPrefix: String,
        context: FilterContext
    ): FilterResult<AbstractRequest> {
        val topics = request.data().topicData().map { it.name() }
        return checkTopicAccess(topics, credentialId, ownPrefix, "write", context)
    }

    private fun checkListOffsetsRequest(
        request: ListOffsetsRequest,
        credentialId: String,
        ownPrefix: String
    ): FilterResult<AbstractRequest> {
        // ListOffsets requires read permission
        val topics = request.data().topics().map { it.name() }
        for (topic in topics) {
            if (!isOwnTopic(topic, ownPrefix) && !aclStore.hasPermission(credentialId, topic, "read")) {
                return FilterResult.Reject(
                    errorCode = 29, // TOPIC_AUTHORIZATION_FAILED
                    message = "No read access to topic: $topic"
                )
            }
        }
        return FilterResult.Pass(request)
    }

    private fun <T : AbstractRequest> checkTopicAccess(
        topics: List<String>,
        credentialId: String,
        ownPrefix: String,
        permission: String,
        context: FilterContext
    ): FilterResult<T> {
        for (topic in topics) {
            if (isOwnTopic(topic, ownPrefix)) {
                // Own topic - check credential permissions
                if (permission == "read" && "read" !in context.permissions && "read-write" !in context.permissions) {
                    @Suppress("UNCHECKED_CAST")
                    return FilterResult.Reject(
                        errorCode = 29,
                        message = "Credential lacks read permission"
                    ) as FilterResult<T>
                }
                if (permission == "write" && "write" !in context.permissions && "read-write" !in context.permissions) {
                    @Suppress("UNCHECKED_CAST")
                    return FilterResult.Reject(
                        errorCode = 29,
                        message = "Credential lacks write permission"
                    ) as FilterResult<T>
                }
            } else {
                // Foreign topic - requires explicit ACL
                if (!aclStore.hasPermission(credentialId, topic, permission)) {
                    @Suppress("UNCHECKED_CAST")
                    return FilterResult.Reject(
                        errorCode = 29, // TOPIC_AUTHORIZATION_FAILED
                        message = "No $permission access to shared topic: $topic"
                    ) as FilterResult<T>
                }
            }
        }
        @Suppress("UNCHECKED_CAST")
        return FilterResult.Pass(topics) as FilterResult<T>
    }

    private fun isOwnTopic(topic: String, ownPrefix: String): Boolean {
        return ownPrefix.isNotEmpty() && topic.startsWith(ownPrefix)
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.filter.TopicACLFilterTest"`

Expected: PASS

**Step 5: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filter/TopicACLFilter.kt
git add gateway/bifrost/src/test/kotlin/io/orbit/bifrost/filter/TopicACLFilterTest.kt
git commit -m "feat(bifrost): add TopicACLFilter for cross-app access control"
```

---

## Task 4: Add ACL RPCs to BifrostAdminService

**Files:**
- Modify: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt`
- Test: `gateway/bifrost/src/test/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImplTest.kt`

**Step 1: Write the failing test**

Add to existing test file or create new:

```kotlin
@Test
fun `upsertTopicACL stores ACL entry`() = runBlocking {
    val request = UpsertTopicACLRequest.newBuilder()
        .setEntry(TopicACLEntry.newBuilder()
            .setId("share-1")
            .setCredentialId("cred-1")
            .setTopicPhysicalName("other-workspace-orders")
            .addPermissions("read")
            .build())
        .build()

    val response = service.upsertTopicACL(request)

    assertTrue(response.success)
    assertTrue(aclStore.hasPermission("cred-1", "other-workspace-orders", "read"))
}

@Test
fun `revokeTopicACL removes ACL entry`() = runBlocking {
    // First add an ACL
    aclStore.upsert(ACLEntry(
        id = "share-1",
        credentialId = "cred-1",
        topicPhysicalName = "other-workspace-orders",
        permissions = setOf("read"),
        expiresAt = null
    ))

    val request = RevokeTopicACLRequest.newBuilder()
        .setAclId("share-1")
        .build()

    val response = service.revokeTopicACL(request)

    assertTrue(response.success)
    assertFalse(aclStore.hasPermission("cred-1", "other-workspace-orders", "read"))
}
```

**Step 2: Run test to verify it fails**

Run: `cd gateway/bifrost && ./gradlew test --tests "io.orbit.bifrost.admin.BifrostAdminServiceImplTest"`

Expected: FAIL - method not found

**Step 3: Add ACLStore to BifrostAdminServiceImpl constructor**

Modify `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt`:

```kotlin
class BifrostAdminServiceImpl(
    private val store: VirtualClusterStore,
    private val credentialStore: CredentialStore = CredentialStore(),
    private val policyStore: PolicyStore = PolicyStore(),
    private val aclStore: ACLStore = ACLStore()  // Add this
) : BifrostAdminServiceGrpcKt.BifrostAdminServiceCoroutineImplBase() {
```

**Step 4: Implement ACL RPCs**

Add to `BifrostAdminServiceImpl.kt`:

```kotlin
override suspend fun upsertTopicACL(request: UpsertTopicACLRequest): UpsertTopicACLResponse {
    val entry = request.entry.toKotlin()
    aclStore.upsert(entry)
    return UpsertTopicACLResponse.newBuilder()
        .setSuccess(true)
        .build()
}

override suspend fun revokeTopicACL(request: RevokeTopicACLRequest): RevokeTopicACLResponse {
    val revoked = aclStore.revoke(request.aclId)
    return RevokeTopicACLResponse.newBuilder()
        .setSuccess(revoked)
        .build()
}

override suspend fun listTopicACLs(request: ListTopicACLsRequest): ListTopicACLsResponse {
    val entries = if (request.credentialId.isNotEmpty()) {
        aclStore.getByCredential(request.credentialId)
    } else {
        aclStore.getAll()
    }
    return ListTopicACLsResponse.newBuilder()
        .addAllEntries(entries.map { it.toProto() })
        .build()
}

// Add extension functions
private fun Gateway.TopicACLEntry.toKotlin(): ACLEntry = ACLEntry(
    id = this.id,
    credentialId = this.credentialId,
    topicPhysicalName = this.topicPhysicalName,
    permissions = this.permissionsList.toSet(),
    expiresAt = if (this.hasExpiresAt()) {
        Instant.ofEpochSecond(this.expiresAt.seconds, this.expiresAt.nanos.toLong())
    } else null
)

private fun ACLEntry.toProto(): Gateway.TopicACLEntry = Gateway.TopicACLEntry.newBuilder()
    .setId(this.id)
    .setCredentialId(this.credentialId)
    .setTopicPhysicalName(this.topicPhysicalName)
    .addAllPermissions(this.permissions.toList())
    .apply {
        this@toProto.expiresAt?.let {
            setExpiresAt(Timestamp.newBuilder()
                .setSeconds(it.epochSecond)
                .setNanos(it.nano)
                .build())
        }
    }
    .build()
```

**Step 5: Update GetFullConfig to include ACLs**

Add to `getFullConfig` method:

```kotlin
override suspend fun getFullConfig(request: GetFullConfigRequest): GetFullConfigResponse {
    return GetFullConfigResponse.newBuilder()
        .addAllVirtualClusters(store.getAll().map { it.toProto() })
        .addAllCredentials(credentialStore.getAll().map { it.toProto() })
        .addAllPolicies(policyStore.getAll().map { it.toProto() })
        .addAllTopicAcls(aclStore.getAll().map { it.toProto() })  // Add this
        .build()
}
```

**Step 6: Run tests**

Run: `cd gateway/bifrost && ./gradlew test`

Expected: PASS

**Step 7: Commit**

```bash
git add gateway/bifrost/src/main/kotlin/io/orbit/bifrost/admin/BifrostAdminServiceImpl.kt
git add gateway/bifrost/src/test/kotlin/io/orbit/bifrost/admin/
git commit -m "feat(bifrost): add ACL management RPCs to admin service"
```

---

## Task 5: Wire TopicACLFilter into FilterChain

**Files:**
- Modify: `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/BifrostServer.kt` (or wherever FilterChain is built)

**Step 1: Add TopicACLFilter to filter chain**

Find where FilterChain is constructed and add:

```kotlin
val aclStore = ACLStore()

val filterChain = FilterChain.builder()
    .addFilter(AuthenticationFilter(credentialStore))
    .addFilter(PolicyEnforcementFilter(policyStore))
    .addFilter(TopicRewriteFilter())
    .addFilter(GroupRewriteFilter())
    .addFilter(TransactionRewriteFilter())
    .addFilter(TopicACLFilter(aclStore))  // Add after rewrite filters
    .build()
```

**Step 2: Pass aclStore to BifrostAdminServiceImpl**

```kotlin
val adminService = BifrostAdminServiceImpl(
    store = virtualClusterStore,
    credentialStore = credentialStore,
    policyStore = policyStore,
    aclStore = aclStore
)
```

**Step 3: Build and verify**

Run: `cd gateway/bifrost && ./gradlew build`

Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add gateway/bifrost/
git commit -m "feat(bifrost): wire TopicACLFilter into filter chain"
```

---

## Task 6: Create TopicShareApprovedWorkflow

**Files:**
- Create: `temporal-workflows/internal/workflows/topic_share_workflow.go`
- Test: `temporal-workflows/internal/workflows/topic_share_workflow_test.go`

**Step 1: Write the failing test**

Create `temporal-workflows/internal/workflows/topic_share_workflow_test.go`:

```go
package workflows

import (
    "testing"
    "time"

    "github.com/stretchr/testify/mock"
    "github.com/stretchr/testify/suite"
    "go.temporal.io/sdk/testsuite"
)

type TopicShareWorkflowTestSuite struct {
    suite.Suite
    testsuite.WorkflowTestSuite
    env *testsuite.TestWorkflowEnvironment
}

func (s *TopicShareWorkflowTestSuite) SetupTest() {
    s.env = s.NewTestWorkflowEnvironment()
}

func (s *TopicShareWorkflowTestSuite) AfterTest(suiteName, testName string) {
    s.env.AssertExpectations(s.T())
}

func (s *TopicShareWorkflowTestSuite) TestTopicShareApprovedWorkflow_Success() {
    input := TopicShareApprovedInput{
        ShareID:           "share-123",
        TopicPhysicalName: "acme-payments-prod-orders",
        CredentialID:      "cred-456",
        Permissions:       []string{"read"},
        ExpiresAt:         nil,
    }

    // Mock activities
    s.env.OnActivity(UpdateShareStatusActivity, mock.Anything, mock.Anything).Return(nil)
    s.env.OnActivity(UpsertTopicACLActivity, mock.Anything, mock.Anything).Return(nil)
    s.env.OnActivity(SendShareApprovedNotificationActivity, mock.Anything, mock.Anything).Return(nil)

    s.env.ExecuteWorkflow(TopicShareApprovedWorkflow, input)

    s.True(s.env.IsWorkflowCompleted())
    s.NoError(s.env.GetWorkflowError())

    var result TopicShareApprovedResult
    s.NoError(s.env.GetWorkflowResult(&result))
    s.True(result.Success)
    s.Equal("share-123", result.ShareID)
}

func TestTopicShareWorkflowTestSuite(t *testing.T) {
    suite.Run(t, new(TopicShareWorkflowTestSuite))
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v ./internal/workflows/topic_share_workflow_test.go`

Expected: FAIL - undefined: TopicShareApprovedWorkflow

**Step 3: Implement the workflow**

Create `temporal-workflows/internal/workflows/topic_share_workflow.go`:

```go
package workflows

import (
    "time"

    "go.temporal.io/sdk/temporal"
    "go.temporal.io/sdk/workflow"
)

// TopicShareApprovedInput contains the data needed to provision access
type TopicShareApprovedInput struct {
    ShareID           string
    TopicPhysicalName string
    CredentialID      string
    Permissions       []string
    ExpiresAt         *time.Time
    ApprovedBy        string
    TopicOwnerEmail   string
    RequesterEmail    string
}

// TopicShareApprovedResult contains the workflow outcome
type TopicShareApprovedResult struct {
    Success  bool
    ShareID  string
    Error    string
}

// TopicShareApprovedWorkflow provisions ACLs after a share is approved
func TopicShareApprovedWorkflow(ctx workflow.Context, input TopicShareApprovedInput) (TopicShareApprovedResult, error) {
    logger := workflow.GetLogger(ctx)
    logger.Info("Starting TopicShareApprovedWorkflow", "shareID", input.ShareID)

    activityOptions := workflow.ActivityOptions{
        StartToCloseTimeout: 2 * time.Minute,
        RetryPolicy: &temporal.RetryPolicy{
            InitialInterval:    time.Second,
            BackoffCoefficient: 2.0,
            MaximumInterval:    30 * time.Second,
            MaximumAttempts:    5,
        },
    }
    ctx = workflow.WithActivityOptions(ctx, activityOptions)

    // Step 1: Update share status to "provisioning"
    err := workflow.ExecuteActivity(ctx, UpdateShareStatusActivity, UpdateShareStatusInput{
        ShareID: input.ShareID,
        Status:  "provisioning",
    }).Get(ctx, nil)
    if err != nil {
        return TopicShareApprovedResult{Success: false, ShareID: input.ShareID, Error: err.Error()}, nil
    }

    // Step 2: Push ACL to Bifrost gateway
    err = workflow.ExecuteActivity(ctx, UpsertTopicACLActivity, UpsertTopicACLInput{
        ShareID:           input.ShareID,
        TopicPhysicalName: input.TopicPhysicalName,
        CredentialID:      input.CredentialID,
        Permissions:       input.Permissions,
        ExpiresAt:         input.ExpiresAt,
    }).Get(ctx, nil)
    if err != nil {
        // Rollback status
        _ = workflow.ExecuteActivity(ctx, UpdateShareStatusActivity, UpdateShareStatusInput{
            ShareID: input.ShareID,
            Status:  "failed",
            Error:   err.Error(),
        }).Get(ctx, nil)
        return TopicShareApprovedResult{Success: false, ShareID: input.ShareID, Error: err.Error()}, nil
    }

    // Step 3: Update share status to "approved"
    err = workflow.ExecuteActivity(ctx, UpdateShareStatusActivity, UpdateShareStatusInput{
        ShareID: input.ShareID,
        Status:  "approved",
    }).Get(ctx, nil)
    if err != nil {
        logger.Warn("Failed to update share status to approved", "error", err)
    }

    // Step 4: Send notification (non-blocking)
    _ = workflow.ExecuteActivity(ctx, SendShareApprovedNotificationActivity, SendShareNotificationInput{
        ShareID:         input.ShareID,
        RequesterEmail:  input.RequesterEmail,
        TopicName:       input.TopicPhysicalName,
        Permissions:     input.Permissions,
    }).Get(ctx, nil)

    logger.Info("TopicShareApprovedWorkflow completed", "shareID", input.ShareID)
    return TopicShareApprovedResult{Success: true, ShareID: input.ShareID}, nil
}

// TopicShareRevokedWorkflow removes ACLs when a share is revoked
func TopicShareRevokedWorkflow(ctx workflow.Context, input TopicShareRevokedInput) (TopicShareRevokedResult, error) {
    logger := workflow.GetLogger(ctx)
    logger.Info("Starting TopicShareRevokedWorkflow", "shareID", input.ShareID)

    activityOptions := workflow.ActivityOptions{
        StartToCloseTimeout: 2 * time.Minute,
        RetryPolicy: &temporal.RetryPolicy{
            InitialInterval:    time.Second,
            BackoffCoefficient: 2.0,
            MaximumInterval:    30 * time.Second,
            MaximumAttempts:    5,
        },
    }
    ctx = workflow.WithActivityOptions(ctx, activityOptions)

    // Step 1: Revoke ACL from Bifrost
    err := workflow.ExecuteActivity(ctx, RevokeTopicACLActivity, RevokeTopicACLInput{
        ShareID: input.ShareID,
    }).Get(ctx, nil)
    if err != nil {
        logger.Error("Failed to revoke ACL", "error", err)
        return TopicShareRevokedResult{Success: false, Error: err.Error()}, nil
    }

    // Step 2: Update share status
    err = workflow.ExecuteActivity(ctx, UpdateShareStatusActivity, UpdateShareStatusInput{
        ShareID: input.ShareID,
        Status:  "revoked",
    }).Get(ctx, nil)
    if err != nil {
        logger.Warn("Failed to update share status", "error", err)
    }

    return TopicShareRevokedResult{Success: true}, nil
}

type TopicShareRevokedInput struct {
    ShareID string
}

type TopicShareRevokedResult struct {
    Success bool
    Error   string
}
```

**Step 4: Run tests**

Run: `cd temporal-workflows && go test -v ./internal/workflows/topic_share_workflow_test.go`

Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/topic_share_workflow.go
git add temporal-workflows/internal/workflows/topic_share_workflow_test.go
git commit -m "feat(temporal): add TopicShareApprovedWorkflow and TopicShareRevokedWorkflow"
```

---

## Task 7: Create Topic Share Activities

**Files:**
- Modify: `temporal-workflows/internal/activities/kafka_activities.go`
- Create: `temporal-workflows/internal/activities/topic_share_activities.go`

**Step 1: Create activity input/output types**

Create `temporal-workflows/internal/activities/topic_share_activities.go`:

```go
package activities

import (
    "context"
    "time"

    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
    "google.golang.org/grpc"
    "google.golang.org/protobuf/types/known/timestamppb"
)

// Activity inputs
type UpdateShareStatusInput struct {
    ShareID string
    Status  string
    Error   string
}

type UpsertTopicACLInput struct {
    ShareID           string
    TopicPhysicalName string
    CredentialID      string
    Permissions       []string
    ExpiresAt         *time.Time
}

type RevokeTopicACLInput struct {
    ShareID string
}

type SendShareNotificationInput struct {
    ShareID        string
    RequesterEmail string
    TopicName      string
    Permissions    []string
}

// TopicShareActivities implements share-related activities
type TopicShareActivities struct {
    bifrostConn   *grpc.ClientConn
    payloadAPIURL string
}

func NewTopicShareActivities(bifrostConn *grpc.ClientConn, payloadAPIURL string) *TopicShareActivities {
    return &TopicShareActivities{
        bifrostConn:   bifrostConn,
        payloadAPIURL: payloadAPIURL,
    }
}

func (a *TopicShareActivities) UpdateShareStatusActivity(ctx context.Context, input UpdateShareStatusInput) error {
    // Call Payload API to update share status
    // POST /api/kafka-topic-shares/{id}
    // This will be implemented when we create the API endpoint
    return nil
}

func (a *TopicShareActivities) UpsertTopicACLActivity(ctx context.Context, input UpsertTopicACLInput) error {
    client := gatewayv1.NewBifrostAdminServiceClient(a.bifrostConn)

    entry := &gatewayv1.TopicACLEntry{
        Id:                input.ShareID,
        CredentialId:      input.CredentialID,
        TopicPhysicalName: input.TopicPhysicalName,
        Permissions:       input.Permissions,
    }
    if input.ExpiresAt != nil {
        entry.ExpiresAt = timestamppb.New(*input.ExpiresAt)
    }

    _, err := client.UpsertTopicACL(ctx, &gatewayv1.UpsertTopicACLRequest{
        Entry: entry,
    })
    return err
}

func (a *TopicShareActivities) RevokeTopicACLActivity(ctx context.Context, input RevokeTopicACLInput) error {
    client := gatewayv1.NewBifrostAdminServiceClient(a.bifrostConn)

    _, err := client.RevokeTopicACL(ctx, &gatewayv1.RevokeTopicACLRequest{
        AclId: input.ShareID,
    })
    return err
}

func (a *TopicShareActivities) SendShareApprovedNotificationActivity(ctx context.Context, input SendShareNotificationInput) error {
    // Send email notification
    // Graceful fallback to logging if email fails
    // This will use the notification service when implemented
    return nil
}
```

**Step 2: Register activities with worker**

Add to worker initialization:

```go
topicShareActivities := activities.NewTopicShareActivities(bifrostConn, payloadAPIURL)
w.RegisterActivity(topicShareActivities.UpdateShareStatusActivity)
w.RegisterActivity(topicShareActivities.UpsertTopicACLActivity)
w.RegisterActivity(topicShareActivities.RevokeTopicACLActivity)
w.RegisterActivity(topicShareActivities.SendShareApprovedNotificationActivity)
```

**Step 3: Commit**

```bash
git add temporal-workflows/internal/activities/topic_share_activities.go
git commit -m "feat(temporal): add topic share activities for ACL sync"
```

---

## Task 8: Create Topic Catalog Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/kafka-topic-catalog.ts`
- Test: `orbit-www/src/app/actions/kafka-topic-catalog.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/app/actions/kafka-topic-catalog.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

describe('kafka-topic-catalog actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be importable', async () => {
    const actions = await import('./kafka-topic-catalog')
    expect(actions.searchTopicCatalog).toBeDefined()
    expect(actions.requestTopicAccess).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/kafka-topic-catalog.test.ts`

Expected: FAIL - module not found

**Step 3: Implement the server actions**

Create `orbit-www/src/app/actions/kafka-topic-catalog.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import type { Where } from 'payload'

// Types
export interface TopicCatalogEntry {
  id: string
  name: string
  description?: string
  workspace: {
    id: string
    name: string
    slug: string
  }
  application?: {
    id: string
    name: string
    slug: string
  }
  environment: string
  visibility: 'private' | 'workspace' | 'discoverable' | 'public'
  tags: string[]
  schemaType?: string
  partitions: number
  hasActiveShare?: boolean
  shareStatus?: string
}

export interface SearchTopicCatalogInput {
  query?: string
  visibility?: ('discoverable' | 'public')[]
  environment?: string
  workspaceId?: string  // For workspace-scoped topics
  tags?: string[]
  page?: number
  limit?: number
}

export interface SearchTopicCatalogResult {
  success: boolean
  topics: TopicCatalogEntry[]
  totalCount: number
  page: number
  totalPages: number
  error?: string
}

export interface RequestTopicAccessInput {
  topicId: string
  accessLevel: 'read' | 'write' | 'read-write'
  reason: string
  requestingWorkspaceId: string
}

export interface RequestTopicAccessResult {
  success: boolean
  shareId?: string
  error?: string
  autoApproved?: boolean
}

// Actions
export async function searchTopicCatalog(
  input: SearchTopicCatalogInput
): Promise<SearchTopicCatalogResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, topics: [], totalCount: 0, page: 1, totalPages: 0, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const page = input.page ?? 1
  const limit = input.limit ?? 20

  try {
    // Get user's workspace memberships for workspace-visibility topics
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 1000,
      overrideAccess: true,
    })
    const userWorkspaceIds = memberships.docs.map(m =>
      typeof m.workspace === 'string' ? m.workspace : m.workspace.id
    )

    // Build query for discoverable/public topics + workspace-visibility from user's workspaces
    const visibilityConditions: Where[] = []

    // Always include discoverable and public
    if (!input.visibility || input.visibility.includes('discoverable')) {
      visibilityConditions.push({ visibility: { equals: 'discoverable' } })
    }
    if (!input.visibility || input.visibility.includes('public')) {
      visibilityConditions.push({ visibility: { equals: 'public' } })
    }

    // Include workspace-visibility topics from user's workspaces
    if (userWorkspaceIds.length > 0) {
      visibilityConditions.push({
        and: [
          { visibility: { equals: 'workspace' } },
          { workspace: { in: userWorkspaceIds } },
        ],
      })
    }

    const where: Where = {
      and: [
        { status: { equals: 'active' } },
        { or: visibilityConditions },
      ],
    }

    // Add search query
    if (input.query) {
      (where.and as Where[]).push({
        or: [
          { name: { contains: input.query } },
          { description: { contains: input.query } },
        ],
      })
    }

    // Add environment filter
    if (input.environment) {
      (where.and as Where[]).push({ environment: { equals: input.environment } })
    }

    // Add workspace filter (for browsing within a workspace)
    if (input.workspaceId) {
      (where.and as Where[]).push({ workspace: { equals: input.workspaceId } })
    }

    const topics = await payload.find({
      collection: 'kafka-topics',
      where,
      page,
      limit,
      sort: '-createdAt',
      depth: 2, // Include workspace and application
    })

    // Check for existing shares for this user's workspaces
    const topicIds = topics.docs.map(t => t.id)
    const existingShares = await payload.find({
      collection: 'kafka-topic-shares',
      where: {
        and: [
          { topic: { in: topicIds } },
          { targetWorkspace: { in: userWorkspaceIds } },
          { status: { in: ['pending', 'approved'] } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    const sharesByTopic = new Map<string, { status: string }>()
    existingShares.docs.forEach(share => {
      const topicId = typeof share.topic === 'string' ? share.topic : share.topic.id
      sharesByTopic.set(topicId, { status: share.status as string })
    })

    const catalogEntries: TopicCatalogEntry[] = topics.docs.map(topic => ({
      id: topic.id,
      name: topic.name,
      description: topic.description || undefined,
      workspace: {
        id: typeof topic.workspace === 'string' ? topic.workspace : topic.workspace.id,
        name: typeof topic.workspace === 'string' ? '' : topic.workspace.name,
        slug: typeof topic.workspace === 'string' ? '' : topic.workspace.slug,
      },
      application: topic.application ? {
        id: typeof topic.application === 'string' ? topic.application : topic.application.id,
        name: typeof topic.application === 'string' ? '' : (topic.application as any).name,
        slug: typeof topic.application === 'string' ? '' : (topic.application as any).slug,
      } : undefined,
      environment: topic.environment,
      visibility: topic.visibility as TopicCatalogEntry['visibility'],
      tags: (topic.tags || []).map((t: any) => t.tag).filter(Boolean),
      partitions: topic.partitions,
      hasActiveShare: sharesByTopic.has(topic.id),
      shareStatus: sharesByTopic.get(topic.id)?.status,
    }))

    return {
      success: true,
      topics: catalogEntries,
      totalCount: topics.totalDocs,
      page: topics.page || 1,
      totalPages: topics.totalPages,
    }
  } catch (error) {
    console.error('Error searching topic catalog:', error)
    return {
      success: false,
      topics: [],
      totalCount: 0,
      page: 1,
      totalPages: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function requestTopicAccess(
  input: RequestTopicAccessInput
): Promise<RequestTopicAccessResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Verify user is member of requesting workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: session.user.id } },
          { workspace: { equals: input.requestingWorkspaceId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of requesting workspace' }
    }

    // Get topic and owner workspace
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: input.topicId,
      depth: 1,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    const ownerWorkspaceId = typeof topic.workspace === 'string'
      ? topic.workspace
      : topic.workspace.id

    // Check if share already exists
    const existingShare = await payload.find({
      collection: 'kafka-topic-shares',
      where: {
        and: [
          { topic: { equals: input.topicId } },
          { targetWorkspace: { equals: input.requestingWorkspaceId } },
          { status: { in: ['pending', 'approved'] } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existingShare.docs.length > 0) {
      return { success: false, error: 'Access request already exists' }
    }

    // Check for auto-approve policies
    const autoApprove = await checkAutoApprove(payload, topic, input.requestingWorkspaceId)

    // Create the share request
    const share = await payload.create({
      collection: 'kafka-topic-shares',
      data: {
        topic: input.topicId,
        ownerWorkspace: ownerWorkspaceId,
        targetWorkspace: input.requestingWorkspaceId,
        accessLevel: input.accessLevel,
        status: autoApprove ? 'approved' : 'pending',
        reason: input.reason,
        requestedBy: session.user.id,
        ...(autoApprove ? { approvedAt: new Date().toISOString() } : {}),
      },
    })

    // If auto-approved, trigger workflow
    if (autoApprove) {
      await triggerShareApprovedWorkflow(share.id, topic, input)
    } else {
      // Send notification to owner workspace admins
      await sendShareRequestNotification(payload, topic, input, session.user)
    }

    revalidatePath(`/[workspace]/kafka/catalog`)
    revalidatePath(`/[workspace]/kafka/shared`)

    return {
      success: true,
      shareId: share.id,
      autoApproved: autoApprove,
    }
  } catch (error) {
    console.error('Error requesting topic access:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Helper functions
async function checkAutoApprove(
  payload: any,
  topic: any,
  requestingWorkspaceId: string
): Promise<boolean> {
  // Check topic visibility
  if (topic.visibility === 'public') {
    return true
  }

  // Check share policies
  const policies = await payload.find({
    collection: 'kafka-topic-share-policies',
    where: {
      and: [
        { enabled: { equals: true } },
        {
          or: [
            { workspace: { equals: null } }, // Platform-wide
            { workspace: { equals: typeof topic.workspace === 'string' ? topic.workspace : topic.workspace.id } },
          ],
        },
      ],
    },
    sort: '-priority',
    limit: 100,
    overrideAccess: true,
  })

  for (const policy of policies.docs) {
    // Check if policy applies to this topic
    if (policy.topicPatterns && policy.topicPatterns.length > 0) {
      const matches = policy.topicPatterns.some((p: any) => {
        const regex = new RegExp(p.pattern)
        return regex.test(topic.name)
      })
      if (!matches) continue
    }

    // Check auto-approve
    if (policy.autoApprove) {
      return true
    }

    // Check auto-approve workspaces
    if (policy.autoApproveWorkspaces && policy.autoApproveWorkspaces.length > 0) {
      const wsIds = policy.autoApproveWorkspaces.map((w: any) =>
        typeof w === 'string' ? w : w.id
      )
      if (wsIds.includes(requestingWorkspaceId)) {
        return true
      }
    }
  }

  return false
}

async function triggerShareApprovedWorkflow(
  shareId: string,
  topic: any,
  input: RequestTopicAccessInput
): Promise<void> {
  // TODO: Call Temporal to start TopicShareApprovedWorkflow
  console.log('Would trigger TopicShareApprovedWorkflow for share:', shareId)
}

async function sendShareRequestNotification(
  payload: any,
  topic: any,
  input: RequestTopicAccessInput,
  requester: any
): Promise<void> {
  // TODO: Send email + in-app notification
  console.log('Would send share request notification for topic:', topic.name)
}
```

**Step 4: Run tests**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/kafka-topic-catalog.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-catalog.ts
git add orbit-www/src/app/actions/kafka-topic-catalog.test.ts
git commit -m "feat(ui): add topic catalog server actions"
```

---

## Task 9: Create Share Approval Server Actions

**Files:**
- Create: `orbit-www/src/app/actions/kafka-topic-shares.ts`

**Step 1: Implement approval actions**

Create `orbit-www/src/app/actions/kafka-topic-shares.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

export interface ApproveShareInput {
  shareId: string
}

export interface ApproveShareResult {
  success: boolean
  error?: string
}

export interface RejectShareInput {
  shareId: string
  reason: string
}

export interface RejectShareResult {
  success: boolean
  error?: string
}

export interface RevokeShareInput {
  shareId: string
}

export interface RevokeShareResult {
  success: boolean
  error?: string
}

export interface ListPendingSharesInput {
  workspaceId: string
  type: 'incoming' | 'outgoing'
}

export interface ShareListItem {
  id: string
  topic: {
    id: string
    name: string
    environment: string
  }
  ownerWorkspace: {
    id: string
    name: string
  }
  targetWorkspace: {
    id: string
    name: string
  }
  accessLevel: string
  status: string
  reason?: string
  requestedBy: {
    id: string
    email: string
  }
  requestedAt: string
}

export interface ListPendingSharesResult {
  success: boolean
  shares: ShareListItem[]
  error?: string
}

export async function approveShare(input: ApproveShareInput): Promise<ApproveShareResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // Get the share
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      depth: 2,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    if (share.status !== 'pending') {
      return { success: false, error: 'Share is not pending approval' }
    }

    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id

    // Verify user is admin of owner workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: session.user.id } },
          { workspace: { equals: ownerWorkspaceId } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not authorized to approve shares for this workspace' }
    }

    // Update share status
    await payload.update({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      data: {
        status: 'approved',
        approvedBy: session.user.id,
        approvedAt: new Date().toISOString(),
      },
    })

    // Trigger workflow to sync ACL to Bifrost
    await triggerShareApprovedWorkflow(share)

    revalidatePath(`/[workspace]/kafka/shared`)

    return { success: true }
  } catch (error) {
    console.error('Error approving share:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function rejectShare(input: RejectShareInput): Promise<RejectShareResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      depth: 1,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id

    // Verify user is admin of owner workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: session.user.id } },
          { workspace: { equals: ownerWorkspaceId } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not authorized' }
    }

    await payload.update({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      data: {
        status: 'rejected',
        rejectionReason: input.reason,
      },
    })

    // Send notification to requester
    await sendShareRejectedNotification(share, input.reason)

    revalidatePath(`/[workspace]/kafka/shared`)

    return { success: true }
  } catch (error) {
    console.error('Error rejecting share:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function revokeShare(input: RevokeShareInput): Promise<RevokeShareResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      depth: 1,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    if (share.status !== 'approved') {
      return { success: false, error: 'Can only revoke approved shares' }
    }

    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id

    // Verify user is admin of owner workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: session.user.id } },
          { workspace: { equals: ownerWorkspaceId } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not authorized' }
    }

    await payload.update({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      data: {
        status: 'revoked',
      },
    })

    // Trigger workflow to remove ACL from Bifrost
    await triggerShareRevokedWorkflow(share)

    revalidatePath(`/[workspace]/kafka/shared`)

    return { success: true }
  } catch (error) {
    console.error('Error revoking share:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function listPendingShares(
  input: ListPendingSharesInput
): Promise<ListPendingSharesResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, shares: [], error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    const whereField = input.type === 'incoming' ? 'ownerWorkspace' : 'targetWorkspace'

    const shares = await payload.find({
      collection: 'kafka-topic-shares',
      where: {
        and: [
          { [whereField]: { equals: input.workspaceId } },
          { status: { equals: 'pending' } },
        ],
      },
      depth: 2,
      sort: '-createdAt',
      limit: 100,
    })

    const items: ShareListItem[] = shares.docs.map(share => ({
      id: share.id,
      topic: {
        id: typeof share.topic === 'string' ? share.topic : share.topic.id,
        name: typeof share.topic === 'string' ? '' : share.topic.name,
        environment: typeof share.topic === 'string' ? '' : share.topic.environment,
      },
      ownerWorkspace: {
        id: typeof share.ownerWorkspace === 'string' ? share.ownerWorkspace : share.ownerWorkspace.id,
        name: typeof share.ownerWorkspace === 'string' ? '' : share.ownerWorkspace.name,
      },
      targetWorkspace: {
        id: typeof share.targetWorkspace === 'string' ? share.targetWorkspace : share.targetWorkspace.id,
        name: typeof share.targetWorkspace === 'string' ? '' : share.targetWorkspace.name,
      },
      accessLevel: share.accessLevel as string,
      status: share.status as string,
      reason: share.reason || undefined,
      requestedBy: {
        id: typeof share.requestedBy === 'string' ? share.requestedBy : share.requestedBy?.id || '',
        email: typeof share.requestedBy === 'string' ? '' : share.requestedBy?.email || '',
      },
      requestedAt: share.createdAt,
    }))

    return { success: true, shares: items }
  } catch (error) {
    console.error('Error listing pending shares:', error)
    return { success: false, shares: [], error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Helper functions
async function triggerShareApprovedWorkflow(share: any): Promise<void> {
  // TODO: Call Temporal
  console.log('Would trigger TopicShareApprovedWorkflow for share:', share.id)
}

async function triggerShareRevokedWorkflow(share: any): Promise<void> {
  // TODO: Call Temporal
  console.log('Would trigger TopicShareRevokedWorkflow for share:', share.id)
}

async function sendShareRejectedNotification(share: any, reason: string): Promise<void> {
  // TODO: Send notification
  console.log('Would send rejection notification for share:', share.id)
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-shares.ts
git commit -m "feat(ui): add topic share approval server actions"
```

---

## Task 10: Create Topic Catalog UI Component

**Files:**
- Create: `orbit-www/src/components/features/kafka/TopicCatalog.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Search, Filter, ExternalLink, Lock, Globe, Building2 } from 'lucide-react'
import {
  searchTopicCatalog,
  requestTopicAccess,
  type TopicCatalogEntry,
  type SearchTopicCatalogInput
} from '@/app/actions/kafka-topic-catalog'

interface TopicCatalogProps {
  currentWorkspaceId: string
  currentWorkspaceName: string
}

const visibilityIcons = {
  private: Lock,
  workspace: Building2,
  discoverable: Search,
  public: Globe,
}

const visibilityLabels = {
  private: 'Private',
  workspace: 'Workspace',
  discoverable: 'Discoverable',
  public: 'Public',
}

export function TopicCatalog({ currentWorkspaceId, currentWorkspaceName }: TopicCatalogProps) {
  const [topics, setTopics] = useState<TopicCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isPending, startTransition] = useTransition()

  // Request access dialog state
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<TopicCatalogEntry | null>(null)
  const [accessLevel, setAccessLevel] = useState<'read' | 'write' | 'read-write'>('read')
  const [accessReason, setAccessReason] = useState('')

  const loadTopics = useCallback(async () => {
    setLoading(true)
    try {
      const input: SearchTopicCatalogInput = {
        query: searchQuery || undefined,
        environment: environmentFilter !== 'all' ? environmentFilter : undefined,
        page,
        limit: 20,
      }
      const result = await searchTopicCatalog(input)
      if (result.success) {
        setTopics(result.topics)
        setTotalPages(result.totalPages)
      } else {
        toast.error(result.error || 'Failed to load topics')
      }
    } catch {
      toast.error('Failed to load topic catalog')
    } finally {
      setLoading(false)
    }
  }, [searchQuery, environmentFilter, page])

  useEffect(() => {
    loadTopics()
  }, [loadTopics])

  const handleRequestAccess = (topic: TopicCatalogEntry) => {
    setSelectedTopic(topic)
    setAccessLevel('read')
    setAccessReason('')
    setRequestDialogOpen(true)
  }

  const submitAccessRequest = async () => {
    if (!selectedTopic) return

    startTransition(async () => {
      const result = await requestTopicAccess({
        topicId: selectedTopic.id,
        accessLevel,
        reason: accessReason,
        requestingWorkspaceId: currentWorkspaceId,
      })

      if (result.success) {
        if (result.autoApproved) {
          toast.success('Access granted automatically!')
        } else {
          toast.success('Access request submitted')
        }
        setRequestDialogOpen(false)
        loadTopics()
      } else {
        toast.error(result.error || 'Failed to request access')
      }
    })
  }

  const getShareStatusBadge = (topic: TopicCatalogEntry) => {
    if (!topic.hasActiveShare) return null
    if (topic.shareStatus === 'approved') {
      return <Badge variant="success">Access Granted</Badge>
    }
    if (topic.shareStatus === 'pending') {
      return <Badge variant="secondary">Pending</Badge>
    }
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Catalog</CardTitle>
        <CardDescription>
          Discover and request access to topics shared across the platform
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Search and Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={environmentFilter} onValueChange={setEnvironmentFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Environments</SelectItem>
              <SelectItem value="dev">Development</SelectItem>
              <SelectItem value="stage">Staging</SelectItem>
              <SelectItem value="prod">Production</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Topics Table */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : topics.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No topics found matching your criteria
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic) => {
                  const VisibilityIcon = visibilityIcons[topic.visibility]
                  const isOwnWorkspace = topic.workspace.id === currentWorkspaceId

                  return (
                    <TableRow key={topic.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{topic.name}</div>
                          {topic.description && (
                            <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                              {topic.description}
                            </div>
                          )}
                          {topic.tags.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {topic.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{topic.workspace.name}</span>
                          {isOwnWorkspace && (
                            <Badge variant="secondary" className="text-xs">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{topic.environment}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <VisibilityIcon className="h-4 w-4" />
                          <span className="text-sm">{visibilityLabels[topic.visibility]}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getShareStatusBadge(topic)}</TableCell>
                      <TableCell className="text-right">
                        {isOwnWorkspace ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/${topic.workspace.slug}/kafka/applications`}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              View
                            </a>
                          </Button>
                        ) : topic.hasActiveShare ? (
                          <span className="text-sm text-muted-foreground">
                            {topic.shareStatus === 'approved' ? 'Granted' : 'Requested'}
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRequestAccess(topic)}
                          >
                            Request Access
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="py-2 px-4 text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {/* Request Access Dialog */}
        <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Topic Access</DialogTitle>
              <DialogDescription>
                Request access to <strong>{selectedTopic?.name}</strong> from{' '}
                <strong>{selectedTopic?.workspace.name}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Access Level</Label>
                <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Read (Consume)</SelectItem>
                    <SelectItem value="write">Write (Produce)</SelectItem>
                    <SelectItem value="read-write">Read + Write</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reason for Access</Label>
                <Textarea
                  placeholder="Explain why you need access to this topic..."
                  value={accessReason}
                  onChange={(e) => setAccessReason(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                Requesting access for: <strong>{currentWorkspaceName}</strong>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={submitAccessRequest}
                disabled={isPending || !accessReason.trim()}
              >
                {isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/features/kafka/TopicCatalog.tsx
git commit -m "feat(ui): add TopicCatalog component for topic discovery"
```

---

## Task 11: Create Catalog Page Route

**Files:**
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/catalog/page.tsx`

**Step 1: Create the page**

```typescript
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { TopicCatalog } from '@/components/features/kafka/TopicCatalog'

interface CatalogPageProps {
  params: Promise<{ slug: string }>
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { slug } = await params
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    notFound()
  }

  const payload = await getPayload({ config })

  // Get workspace
  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaces.docs.length === 0) {
    notFound()
  }

  const workspace = workspaces.docs[0]

  // Verify user is member
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    notFound()
  }

  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Topic Catalog</h1>
        <p className="text-muted-foreground">
          Discover and request access to Kafka topics across the platform
        </p>
      </div>

      <Suspense fallback={<div>Loading catalog...</div>}>
        <TopicCatalog
          currentWorkspaceId={workspace.id}
          currentWorkspaceName={workspace.name}
        />
      </Suspense>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/kafka/catalog/
git commit -m "feat(ui): add topic catalog page route"
```

---

## Task 12: Create Shared Topics Pages (Incoming/Outgoing)

**Files:**
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/shared/incoming/page.tsx`
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/shared/outgoing/page.tsx`
- Create: `orbit-www/src/components/features/kafka/SharedTopicsList.tsx`

**Step 1: Create SharedTopicsList component**

Create `orbit-www/src/components/features/kafka/SharedTopicsList.tsx`:

```typescript
'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { MoreHorizontal, Check, X, Trash2 } from 'lucide-react'
import {
  listPendingShares,
  approveShare,
  rejectShare,
  revokeShare,
  type ShareListItem
} from '@/app/actions/kafka-topic-shares'

interface SharedTopicsListProps {
  workspaceId: string
  type: 'incoming' | 'outgoing'
  canManage: boolean
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  revoked: 'bg-gray-100 text-gray-800',
}

export function SharedTopicsList({ workspaceId, type, canManage }: SharedTopicsListProps) {
  const [shares, setShares] = useState<ShareListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Dialog states
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [selectedShare, setSelectedShare] = useState<ShareListItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const loadShares = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listPendingShares({ workspaceId, type })
      if (result.success) {
        setShares(result.shares)
      } else {
        toast.error(result.error || 'Failed to load shares')
      }
    } catch {
      toast.error('Failed to load shares')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, type])

  useEffect(() => {
    loadShares()
  }, [loadShares])

  const handleApprove = async (share: ShareListItem) => {
    startTransition(async () => {
      const result = await approveShare({ shareId: share.id })
      if (result.success) {
        toast.success('Access approved')
        loadShares()
      } else {
        toast.error(result.error || 'Failed to approve')
      }
    })
  }

  const handleReject = async () => {
    if (!selectedShare) return
    startTransition(async () => {
      const result = await rejectShare({ shareId: selectedShare.id, reason: rejectReason })
      if (result.success) {
        toast.success('Request rejected')
        setRejectDialogOpen(false)
        setRejectReason('')
        loadShares()
      } else {
        toast.error(result.error || 'Failed to reject')
      }
    })
  }

  const handleRevoke = async () => {
    if (!selectedShare) return
    startTransition(async () => {
      const result = await revokeShare({ shareId: selectedShare.id })
      if (result.success) {
        toast.success('Access revoked')
        setRevokeDialogOpen(false)
        loadShares()
      } else {
        toast.error(result.error || 'Failed to revoke')
      }
    })
  }

  const openRejectDialog = (share: ShareListItem) => {
    setSelectedShare(share)
    setRejectReason('')
    setRejectDialogOpen(true)
  }

  const openRevokeDialog = (share: ShareListItem) => {
    setSelectedShare(share)
    setRevokeDialogOpen(true)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {type === 'incoming' ? 'Incoming Share Requests' : 'Outgoing Share Requests'}
          </CardTitle>
          <CardDescription>
            {type === 'incoming'
              ? 'Topics other workspaces are requesting access to'
              : 'Your requests for access to topics from other workspaces'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : shares.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No {type === 'incoming' ? 'pending requests' : 'active requests'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Topic</TableHead>
                  <TableHead>{type === 'incoming' ? 'Requester' : 'Owner'}</TableHead>
                  <TableHead>Access Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  {canManage && type === 'incoming' && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shares.map((share) => (
                  <TableRow key={share.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{share.topic.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {share.topic.environment}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {type === 'incoming' ? share.targetWorkspace.name : share.ownerWorkspace.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{share.accessLevel}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[share.status]}>{share.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {share.reason || '-'}
                    </TableCell>
                    {canManage && type === 'incoming' && (
                      <TableCell className="text-right">
                        {share.status === 'pending' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleApprove(share)}>
                                <Check className="h-4 w-4 mr-2" />
                                Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openRejectDialog(share)}>
                                <X className="h-4 w-4 mr-2" />
                                Reject
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {share.status === 'approved' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openRevokeDialog(share)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Access Request</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isPending || !rejectReason.trim()}
            >
              {isPending ? 'Rejecting...' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Access</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately remove access to the topic. The other workspace will no longer be able to consume or produce to this topic.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Revoking...' : 'Revoke Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

**Step 2: Create incoming page**

Create `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/shared/incoming/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { SharedTopicsList } from '@/components/features/kafka/SharedTopicsList'

interface IncomingPageProps {
  params: Promise<{ slug: string }>
}

export default async function IncomingSharesPage({ params }: IncomingPageProps) {
  const { slug } = await params
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    notFound()
  }

  const payload = await getPayload({ config })

  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaces.docs.length === 0) {
    notFound()
  }

  const workspace = workspaces.docs[0]

  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    notFound()
  }

  const userRole = membership.docs[0].role as string
  const canManage = ['owner', 'admin'].includes(userRole)

  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Incoming Share Requests</h1>
        <p className="text-muted-foreground">
          Manage access requests from other workspaces to your topics
        </p>
      </div>

      <SharedTopicsList
        workspaceId={workspace.id}
        type="incoming"
        canManage={canManage}
      />
    </div>
  )
}
```

**Step 3: Create outgoing page**

Create `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/shared/outgoing/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { SharedTopicsList } from '@/components/features/kafka/SharedTopicsList'

interface OutgoingPageProps {
  params: Promise<{ slug: string }>
}

export default async function OutgoingSharesPage({ params }: OutgoingPageProps) {
  const { slug } = await params
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    notFound()
  }

  const payload = await getPayload({ config })

  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaces.docs.length === 0) {
    notFound()
  }

  const workspace = workspaces.docs[0]

  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    notFound()
  }

  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Access Requests</h1>
        <p className="text-muted-foreground">
          Track your requests for access to topics from other workspaces
        </p>
      </div>

      <SharedTopicsList
        workspaceId={workspace.id}
        type="outgoing"
        canManage={false}
      />
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add orbit-www/src/components/features/kafka/SharedTopicsList.tsx
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/kafka/shared/
git commit -m "feat(ui): add shared topics pages (incoming/outgoing)"
```

---

## Task 13: Add Navigation Links

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/layout.tsx` (or navigation component)

**Step 1: Add catalog and shared links to Kafka navigation**

Find the Kafka navigation component and add:

```typescript
const kafkaNavItems = [
  { href: `/${slug}/kafka/applications`, label: 'Applications' },
  { href: `/${slug}/kafka/catalog`, label: 'Topic Catalog' },
  { href: `/${slug}/kafka/shared/incoming`, label: 'Incoming Shares' },
  { href: `/${slug}/kafka/shared/outgoing`, label: 'My Requests' },
]
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/workspaces/\[slug\]/kafka/
git commit -m "feat(ui): add navigation links for catalog and shared topics"
```

---

## Task 14: Add Visibility Field to Topic Creation

**Files:**
- Modify: `orbit-www/src/components/features/kafka/VirtualClusterCreateTopicDialog.tsx`

**Step 1: Add visibility select to topic creation form**

Add to the form fields:

```typescript
<div className="space-y-2">
  <Label htmlFor="visibility">Visibility</Label>
  <Select value={visibility} onValueChange={setVisibility}>
    <SelectTrigger>
      <SelectValue placeholder="Select visibility" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="private">Private (Owning Application)</SelectItem>
      <SelectItem value="workspace">Workspace (Same Workspace)</SelectItem>
      <SelectItem value="discoverable">Discoverable (Catalog Listed)</SelectItem>
      <SelectItem value="public">Public (All Applications)</SelectItem>
    </SelectContent>
  </Select>
  <p className="text-sm text-muted-foreground">
    Controls who can discover and request access to this topic
  </p>
</div>
```

**Step 2: Update createTopic action to include visibility**

Ensure the `createTopic` server action accepts and saves visibility.

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/kafka/VirtualClusterCreateTopicDialog.tsx
git commit -m "feat(ui): add visibility field to topic creation"
```

---

## Task 15: Integration Testing

**Files:**
- Create: `orbit-www/src/app/actions/kafka-topic-catalog.integration.test.ts`

**Step 1: Write integration tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// Integration tests that verify end-to-end flow
// These require test database setup

describe('Topic Sharing Integration', () => {
  it.todo('user can search catalog and see discoverable topics')
  it.todo('user can request access to a discoverable topic')
  it.todo('workspace admin can approve a share request')
  it.todo('approved share triggers ACL sync workflow')
  it.todo('revoked share removes ACL from gateway')
})
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-catalog.integration.test.ts
git commit -m "test: add integration test stubs for topic sharing"
```

---

## Summary

This plan covers all Phase 5 tasks:

| Design Task | Plan Task(s) |
|-------------|--------------|
| 5.1 Add visibility field to KafkaTopics | Task 14 |
| 5.2 Topic catalog UI | Tasks 8, 10, 11 |
| 5.3 Access request flow | Tasks 8, 9 |
| 5.4 TopicShareApprovedWorkflow | Tasks 6, 7 |
| 5.5 UpdateTopicACL in Bifrost | Tasks 1, 2, 3, 4, 5 |
| 5.6 Shared topics UI (incoming/outgoing) | Task 12, 13 |
| 5.7 E2E test | Task 15 |

Total: 15 tasks covering gateway ACL enforcement, Temporal workflows, server actions, and UI components.
