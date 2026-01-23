# Consumer Group API Support Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Enable full consumer group functionality through Bifrost with proper multi-tenant isolation via group ID prefixing/unprefixing.

**Architecture:** Extend the existing request/response modifier pattern to handle consumer group APIs. Group IDs are prefixed in requests and unprefixed in responses, similar to how topic names are handled.

**Tech Stack:** Go, Kafka protocol schemas, existing Bifrost modifier infrastructure.

---

## API Coverage

| API Key | Name | Request Changes | Response Changes |
|---------|------|-----------------|------------------|
| 10 | FindCoordinator | Prefix key (group or txn based on key_type) | Already done (broker addresses) |
| 11 | JoinGroup | Prefix group_id | None |
| 14 | SyncGroup | Prefix group_id | None |
| 12 | Heartbeat | Prefix group_id | None |
| 13 | LeaveGroup | Prefix group_id | None |
| 8 | OffsetCommit | Prefix group_id + topics | Unprefix topics |
| 9 | OffsetFetch | Prefix group_id + topics | Unprefix topics |
| 15 | DescribeGroups | Prefix group_ids | Unprefix group_id (skip member_assignment) |
| 16 | ListGroups | None | Filter by prefix + unprefix group_ids |

## Key Design Decisions

### FindCoordinator Prefixing
- Check `key_type` field: 0 = group coordinator (apply GroupPrefixer), 1 = transaction coordinator (apply TxnIDPrefixer)
- Ensures correct semantic behavior for both use cases

### OffsetCommit/OffsetFetch Requirements
- Require both `GroupPrefixer` and `TopicPrefixer` to be configured
- If either is nil, return nil modifier (no modification)
- Fail-safe approach: partial prefixing would create inconsistent state

### ListGroups Filtering
- Filter response to only include groups starting with tenant's prefix
- Unprefix matching group IDs before returning to client
- Matches pattern used for topic filtering in Metadata responses

### DescribeGroups member_assignment
- Skip decoding/re-encoding the `member_assignment` binary blob
- Only unprefix the `group_id` field in the response
- YAGNI: most monitoring tools display group ID and state, not raw assignment bytes
- Can add assignment decoding later if a real need emerges

## Schema Versions

| API | Versions | Flexible (compact) starting at |
|-----|----------|-------------------------------|
| FindCoordinator | 0-5 | v3 |
| JoinGroup | 0-9 | v6 |
| SyncGroup | 0-5 | v4 |
| Heartbeat | 0-4 | v4 |
| LeaveGroup | 0-5 | v4 |
| OffsetCommit | 0-9 | v8 |
| OffsetFetch | 0-9 | v6 |
| DescribeGroups | 0-5 | v5 |
| ListGroups | 0-4 | v3 |

## Response Modifier Config Changes

Add new fields to `ResponseModifierConfig`:

```go
type ResponseModifierConfig struct {
    NetAddressMappingFunc config.NetAddressMappingFunc
    TopicUnprefixer       TopicUnprefixer
    TopicFilter           TopicFilter
    GroupUnprefixer       func(group string) string  // NEW
    GroupFilter           func(group string) bool    // NEW
}
```

## Implementation Order

### Phase 1: Core Consumer Group Flow
Enables basic consumer group joining and coordination.

1. JoinGroup request modifier
2. SyncGroup request modifier
3. Heartbeat request modifier
4. LeaveGroup request modifier
5. FindCoordinator request modifier (key_type aware)

### Phase 2: Offset Management
Enables consumer progress tracking and persistence.

6. OffsetCommit request + response modifiers
7. OffsetFetch request + response modifiers

### Phase 3: Group Management
Enables monitoring and admin operations.

8. Add GroupUnprefixer and GroupFilter to ResponseModifierConfig
9. DescribeGroups request + response modifiers
10. ListGroups response modifier

### Phase 4: Testing

11. Unit tests for all modifiers
12. Integration test for full consumer group flow

## Testing Strategy

### Unit Tests
For each modifier:
- Basic prefixing/unprefixing verification
- Version coverage (non-flexible + flexible)
- Nil prefixer handling
- Round-trip encode/decode integrity

### Integration Test
End-to-end test that:
1. Creates virtual cluster with group prefix
2. Connects consumer through Bifrost with consumer group
3. Produces/consumes messages (triggers JoinGroup, SyncGroup, Heartbeat, OffsetCommit)
4. Calls ListGroups - verifies unprefixed group names
5. Calls DescribeGroups - verifies group details
6. Verifies upstream Kafka has prefixed group name

## Files to Modify

- `internal/proxy/protocol/requests.go` - implement stub modifiers, add request schemas
- `internal/proxy/protocol/responses.go` - add GroupUnprefixer/GroupFilter, new response modifiers, add response schemas
- `internal/proxy/bifrost_proxy.go` - wire up GroupUnprefixer/GroupFilter in config
- New: `internal/proxy/consumer_group_integration_test.go`
