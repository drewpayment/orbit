# Consumer Group APIs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement full consumer group API support in Bifrost with group ID prefixing/unprefixing for multi-tenant isolation.

**Architecture:** Extend existing request/response modifier pattern. Group IDs are prefixed in requests and unprefixed in responses. Rewriter already has UnprefixGroup/PrefixGroup methods.

**Tech Stack:** Go, Kafka protocol schemas, testify for testing.

---

## Phase 1: Core Consumer Group Flow

### Task 1: JoinGroup Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestJoinGroupRequestModifier_PrefixesGroupId(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
	}

	mod, err := GetRequestModifier(apiKeyJoinGroup, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// JoinGroup v0 request: group_id (string), session_timeout_ms (int32),
	// member_id (string), protocol_type (string), group_protocols (array)
	// We only need to decode enough to get group_id
	groupId := "my-group"
	var requestBytes []byte
	// group_id: length (2 bytes) + content
	requestBytes = append(requestBytes, 0, byte(len(groupId)))
	requestBytes = append(requestBytes, []byte(groupId)...)
	// session_timeout_ms: 30000
	requestBytes = append(requestBytes, 0, 0, 0x75, 0x30)
	// member_id: empty string
	requestBytes = append(requestBytes, 0, 0)
	// protocol_type: "consumer"
	protocolType := "consumer"
	requestBytes = append(requestBytes, 0, byte(len(protocolType)))
	requestBytes = append(requestBytes, []byte(protocolType)...)
	// group_protocols: empty array
	requestBytes = append(requestBytes, 0, 0, 0, 0)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	// Decode result and verify group_id is prefixed
	groupIdLen := int(result[0])<<8 | int(result[1])
	resultGroupId := string(result[2 : 2+groupIdLen])
	assert.Equal(t, "tenant:my-group", resultGroupId)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestJoinGroupRequestModifier -v`
Expected: FAIL (modifier returns nil)

**Step 3: Add JoinGroup request schema and modifier**

Add to `requests.go` after the existing modifier structs:

```go
// joinGroupRequestModifier prefixes group_id in JoinGroup requests
type joinGroupRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *joinGroupRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode join group request: %w", err)
	}

	if err := modifyJoinGroupRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify join group request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyJoinGroupRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var joinGroupRequestSchemaVersions = createJoinGroupRequestSchemas()

func createJoinGroupRequestSchemas() []Schema {
	// Protocol metadata is opaque bytes
	groupProtocolV0 := NewSchema("group_protocol_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Mfield{Name: "metadata", Ty: TypeBytes},
	)

	// v0-v5: non-flexible
	joinGroupV0 := NewSchema("join_group_request_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Array{Name: "protocols", Ty: groupProtocolV0},
	)

	// v1 adds rebalance_timeout_ms
	joinGroupV1 := NewSchema("join_group_request_v1",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Array{Name: "protocols", Ty: groupProtocolV0},
	)

	// v5 adds group_instance_id
	joinGroupV5 := NewSchema("join_group_request_v5",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Array{Name: "protocols", Ty: groupProtocolV0},
	)

	// v6+ flexible
	groupProtocolV6 := NewSchema("group_protocol_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&Mfield{Name: "metadata", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "protocol_tagged_fields"},
	)

	joinGroupV6 := NewSchema("join_group_request_v6",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&CompactArray{Name: "protocols", Ty: groupProtocolV6},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v8 adds reason
	joinGroupV8 := NewSchema("join_group_request_v8",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&CompactArray{Name: "protocols", Ty: groupProtocolV6},
		&Mfield{Name: "reason", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		joinGroupV0, // v0
		joinGroupV1, // v1
		joinGroupV1, // v2
		joinGroupV1, // v3
		joinGroupV1, // v4
		joinGroupV5, // v5
		joinGroupV6, // v6
		joinGroupV6, // v7
		joinGroupV8, // v8
		joinGroupV8, // v9
	}
}

func getJoinGroupRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(joinGroupRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported JoinGroup request version %d", apiVersion)
	}
	return joinGroupRequestSchemaVersions[apiVersion], nil
}
```

Update `newJoinGroupRequestModifier`:

```go
func newJoinGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getJoinGroupRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &joinGroupRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestJoinGroupRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement JoinGroup request modifier"
```

---

### Task 2: SyncGroup Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestSyncGroupRequestModifier_PrefixesGroupId(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
	}

	mod, err := GetRequestModifier(apiKeySyncGroup, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// SyncGroup v0: group_id, generation_id, member_id, assignments[]
	groupId := "my-group"
	memberId := "member-1"
	var requestBytes []byte
	// group_id
	requestBytes = append(requestBytes, 0, byte(len(groupId)))
	requestBytes = append(requestBytes, []byte(groupId)...)
	// generation_id: 1
	requestBytes = append(requestBytes, 0, 0, 0, 1)
	// member_id
	requestBytes = append(requestBytes, 0, byte(len(memberId)))
	requestBytes = append(requestBytes, []byte(memberId)...)
	// assignments: empty array
	requestBytes = append(requestBytes, 0, 0, 0, 0)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	// Verify group_id is prefixed
	groupIdLen := int(result[0])<<8 | int(result[1])
	resultGroupId := string(result[2 : 2+groupIdLen])
	assert.Equal(t, "tenant:my-group", resultGroupId)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestSyncGroupRequestModifier -v`
Expected: FAIL

**Step 3: Add SyncGroup request schema and modifier**

```go
// syncGroupRequestModifier prefixes group_id in SyncGroup requests
type syncGroupRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *syncGroupRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode sync group request: %w", err)
	}

	if err := modifySyncGroupRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify sync group request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifySyncGroupRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var syncGroupRequestSchemaVersions = createSyncGroupRequestSchemas()

func createSyncGroupRequestSchemas() []Schema {
	assignmentV0 := NewSchema("sync_group_assignment_v0",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "assignment", Ty: TypeBytes},
	)

	syncGroupV0 := NewSchema("sync_group_request_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "assignments", Ty: assignmentV0},
	)

	// v3 adds group_instance_id
	syncGroupV3 := NewSchema("sync_group_request_v3",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Array{Name: "assignments", Ty: assignmentV0},
	)

	// v4+ flexible
	assignmentV4 := NewSchema("sync_group_assignment_v4",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "assignment", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "assignment_tagged_fields"},
	)

	syncGroupV4 := NewSchema("sync_group_request_v4",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&CompactArray{Name: "assignments", Ty: assignmentV4},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v5 adds protocol_type and protocol_name
	syncGroupV5 := NewSchema("sync_group_request_v5",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_name", Ty: TypeCompactNullableStr},
		&CompactArray{Name: "assignments", Ty: assignmentV4},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		syncGroupV0, // v0
		syncGroupV0, // v1
		syncGroupV0, // v2
		syncGroupV3, // v3
		syncGroupV4, // v4
		syncGroupV5, // v5
	}
}

func getSyncGroupRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(syncGroupRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported SyncGroup request version %d", apiVersion)
	}
	return syncGroupRequestSchemaVersions[apiVersion], nil
}
```

Update `newSyncGroupRequestModifier`:

```go
func newSyncGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getSyncGroupRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &syncGroupRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestSyncGroupRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement SyncGroup request modifier"
```

---

### Task 3: Heartbeat Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestHeartbeatRequestModifier_PrefixesGroupId(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
	}

	mod, err := GetRequestModifier(apiKeyHeartbeat, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// Heartbeat v0: group_id, generation_id, member_id
	groupId := "my-group"
	memberId := "member-1"
	var requestBytes []byte
	// group_id
	requestBytes = append(requestBytes, 0, byte(len(groupId)))
	requestBytes = append(requestBytes, []byte(groupId)...)
	// generation_id: 1
	requestBytes = append(requestBytes, 0, 0, 0, 1)
	// member_id
	requestBytes = append(requestBytes, 0, byte(len(memberId)))
	requestBytes = append(requestBytes, []byte(memberId)...)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	groupIdLen := int(result[0])<<8 | int(result[1])
	resultGroupId := string(result[2 : 2+groupIdLen])
	assert.Equal(t, "tenant:my-group", resultGroupId)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestHeartbeatRequestModifier -v`
Expected: FAIL

**Step 3: Add Heartbeat request schema and modifier**

```go
type heartbeatRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *heartbeatRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode heartbeat request: %w", err)
	}

	if err := modifyHeartbeatRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify heartbeat request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyHeartbeatRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var heartbeatRequestSchemaVersions = createHeartbeatRequestSchemas()

func createHeartbeatRequestSchemas() []Schema {
	heartbeatV0 := NewSchema("heartbeat_request_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
	)

	// v3 adds group_instance_id
	heartbeatV3 := NewSchema("heartbeat_request_v3",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
	)

	// v4+ flexible
	heartbeatV4 := NewSchema("heartbeat_request_v4",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		heartbeatV0, // v0
		heartbeatV0, // v1
		heartbeatV0, // v2
		heartbeatV3, // v3
		heartbeatV4, // v4
	}
}

func getHeartbeatRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(heartbeatRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported Heartbeat request version %d", apiVersion)
	}
	return heartbeatRequestSchemaVersions[apiVersion], nil
}
```

Update `newHeartbeatRequestModifier`:

```go
func newHeartbeatRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getHeartbeatRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &heartbeatRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestHeartbeatRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement Heartbeat request modifier"
```

---

### Task 4: LeaveGroup Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestLeaveGroupRequestModifier_PrefixesGroupId(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
	}

	mod, err := GetRequestModifier(apiKeyLeaveGroup, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// LeaveGroup v0: group_id, member_id
	groupId := "my-group"
	memberId := "member-1"
	var requestBytes []byte
	// group_id
	requestBytes = append(requestBytes, 0, byte(len(groupId)))
	requestBytes = append(requestBytes, []byte(groupId)...)
	// member_id
	requestBytes = append(requestBytes, 0, byte(len(memberId)))
	requestBytes = append(requestBytes, []byte(memberId)...)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	groupIdLen := int(result[0])<<8 | int(result[1])
	resultGroupId := string(result[2 : 2+groupIdLen])
	assert.Equal(t, "tenant:my-group", resultGroupId)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestLeaveGroupRequestModifier -v`
Expected: FAIL

**Step 3: Add LeaveGroup request schema and modifier**

```go
type leaveGroupRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *leaveGroupRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode leave group request: %w", err)
	}

	if err := modifyLeaveGroupRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify leave group request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyLeaveGroupRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var leaveGroupRequestSchemaVersions = createLeaveGroupRequestSchemas()

func createLeaveGroupRequestSchemas() []Schema {
	leaveGroupV0 := NewSchema("leave_group_request_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "member_id", Ty: TypeStr},
	)

	// v3 adds members array instead of single member_id
	memberV3 := NewSchema("leave_group_member_v3",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
	)

	leaveGroupV3 := NewSchema("leave_group_request_v3",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV3},
	)

	// v4+ flexible
	memberV4 := NewSchema("leave_group_member_v4",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "member_tagged_fields"},
	)

	leaveGroupV4 := NewSchema("leave_group_request_v4",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "members", Ty: memberV4},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v5 adds reason
	memberV5 := NewSchema("leave_group_member_v5",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "reason", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "member_tagged_fields"},
	)

	leaveGroupV5 := NewSchema("leave_group_request_v5",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "members", Ty: memberV5},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		leaveGroupV0, // v0
		leaveGroupV0, // v1
		leaveGroupV0, // v2
		leaveGroupV3, // v3
		leaveGroupV4, // v4
		leaveGroupV5, // v5
	}
}

func getLeaveGroupRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(leaveGroupRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported LeaveGroup request version %d", apiVersion)
	}
	return leaveGroupRequestSchemaVersions[apiVersion], nil
}
```

Update `newLeaveGroupRequestModifier`:

```go
func newLeaveGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getLeaveGroupRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &leaveGroupRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestLeaveGroupRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement LeaveGroup request modifier"
```

---

### Task 5: FindCoordinator Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing tests**

```go
func TestFindCoordinatorRequestModifier_PrefixesGroupKey(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
		TxnIDPrefixer: func(txn string) string { return "txn:" + txn },
	}

	mod, err := GetRequestModifier(apiKeyFindCoordinator, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// FindCoordinator v0: key (string) - always treated as group in v0
	key := "my-group"
	var requestBytes []byte
	requestBytes = append(requestBytes, 0, byte(len(key)))
	requestBytes = append(requestBytes, []byte(key)...)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	keyLen := int(result[0])<<8 | int(result[1])
	resultKey := string(result[2 : 2+keyLen])
	assert.Equal(t, "tenant:my-group", resultKey)
}

func TestFindCoordinatorRequestModifier_PrefixesTxnKey(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
		TxnIDPrefixer: func(txn string) string { return "txn:" + txn },
	}

	// v1+ has key_type field
	mod, err := GetRequestModifier(apiKeyFindCoordinator, 1, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// FindCoordinator v1: key (string), key_type (int8)
	key := "my-txn"
	var requestBytes []byte
	requestBytes = append(requestBytes, 0, byte(len(key)))
	requestBytes = append(requestBytes, []byte(key)...)
	requestBytes = append(requestBytes, 1) // key_type = 1 (transaction)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	keyLen := int(result[0])<<8 | int(result[1])
	resultKey := string(result[2 : 2+keyLen])
	assert.Equal(t, "txn:my-txn", resultKey)
}
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestFindCoordinatorRequestModifier -v`
Expected: FAIL

**Step 3: Add FindCoordinator request schema and modifier**

```go
const (
	keyTypeGroup       = int8(0)
	keyTypeTransaction = int8(1)
)

type findCoordinatorRequestModifier struct {
	schema        Schema
	apiVersion    int16
	groupPrefixer GroupPrefixer
	txnIDPrefixer TxnIDPrefixer
}

func (m *findCoordinatorRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode find coordinator request: %w", err)
	}

	if err := modifyFindCoordinatorRequest(decoded, m.apiVersion, m.groupPrefixer, m.txnIDPrefixer); err != nil {
		return nil, fmt.Errorf("modify find coordinator request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyFindCoordinatorRequest(decoded *Struct, apiVersion int16, groupPrefixer GroupPrefixer, txnIDPrefixer TxnIDPrefixer) error {
	key := decoded.Get("key")
	if key == nil {
		return nil
	}

	keyStr, ok := key.(string)
	if !ok || keyStr == "" {
		return nil
	}

	// v0 has no key_type, always group
	if apiVersion == 0 {
		if groupPrefixer != nil {
			return decoded.Replace("key", groupPrefixer(keyStr))
		}
		return nil
	}

	// v1+ has key_type
	keyType := decoded.Get("key_type")
	if keyType == nil {
		// Default to group if not specified
		if groupPrefixer != nil {
			return decoded.Replace("key", groupPrefixer(keyStr))
		}
		return nil
	}

	kt, ok := keyType.(int8)
	if !ok {
		return nil
	}

	switch kt {
	case keyTypeGroup:
		if groupPrefixer != nil {
			return decoded.Replace("key", groupPrefixer(keyStr))
		}
	case keyTypeTransaction:
		if txnIDPrefixer != nil {
			return decoded.Replace("key", txnIDPrefixer(keyStr))
		}
	}

	return nil
}

var findCoordinatorRequestSchemaVersions = createFindCoordinatorRequestSchemas()

func createFindCoordinatorRequestSchemas() []Schema {
	// v0: just key
	findCoordinatorV0 := NewSchema("find_coordinator_request_v0",
		&Mfield{Name: "key", Ty: TypeStr},
	)

	// v1-v2: key + key_type
	findCoordinatorV1 := NewSchema("find_coordinator_request_v1",
		&Mfield{Name: "key", Ty: TypeStr},
		&Mfield{Name: "key_type", Ty: TypeInt8},
	)

	// v3+ flexible
	findCoordinatorV3 := NewSchema("find_coordinator_request_v3",
		&Mfield{Name: "key", Ty: TypeCompactStr},
		&Mfield{Name: "key_type", Ty: TypeInt8},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v4+ adds coordinator_keys array for batched lookups
	findCoordinatorV4 := NewSchema("find_coordinator_request_v4",
		&Mfield{Name: "key_type", Ty: TypeInt8},
		&CompactArray{Name: "coordinator_keys", Ty: TypeCompactStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		findCoordinatorV0, // v0
		findCoordinatorV1, // v1
		findCoordinatorV1, // v2
		findCoordinatorV3, // v3
		findCoordinatorV4, // v4
		findCoordinatorV4, // v5
	}
}

func getFindCoordinatorRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(findCoordinatorRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported FindCoordinator request version %d", apiVersion)
	}
	return findCoordinatorRequestSchemaVersions[apiVersion], nil
}
```

Update `newFindCoordinatorRequestModifier`:

```go
func newFindCoordinatorRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil && cfg.TxnIDPrefixer == nil {
		return nil, nil
	}
	schema, err := getFindCoordinatorRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &findCoordinatorRequestModifier{
		schema:        schema,
		apiVersion:    apiVersion,
		groupPrefixer: cfg.GroupPrefixer,
		txnIDPrefixer: cfg.TxnIDPrefixer,
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestFindCoordinatorRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement FindCoordinator request modifier with key_type support"
```

---

## Phase 2: Offset Management

### Task 6: OffsetCommit Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestOffsetCommitRequestModifier_PrefixesGroupAndTopics(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
		TopicPrefixer: func(topic string) string { return "tenant:" + topic },
	}

	mod, err := GetRequestModifier(apiKeyOffsetCommit, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// OffsetCommit v0: group_id, topics[]
	groupId := "my-group"
	topicName := "my-topic"
	var requestBytes []byte
	// group_id
	requestBytes = append(requestBytes, 0, byte(len(groupId)))
	requestBytes = append(requestBytes, []byte(groupId)...)
	// topics array: length 1
	requestBytes = append(requestBytes, 0, 0, 0, 1)
	// topic name
	requestBytes = append(requestBytes, 0, byte(len(topicName)))
	requestBytes = append(requestBytes, []byte(topicName)...)
	// partitions array: length 1
	requestBytes = append(requestBytes, 0, 0, 0, 1)
	// partition_index: 0
	requestBytes = append(requestBytes, 0, 0, 0, 0)
	// committed_offset: 100
	requestBytes = append(requestBytes, 0, 0, 0, 0, 0, 0, 0, 100)
	// committed_metadata: empty
	requestBytes = append(requestBytes, 0, 0)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	// Verify group_id is prefixed
	groupIdLen := int(result[0])<<8 | int(result[1])
	resultGroupId := string(result[2 : 2+groupIdLen])
	assert.Equal(t, "tenant:my-group", resultGroupId)

	// Verify topic is prefixed (after group_id + array length)
	offset := 2 + groupIdLen + 4 // group_id + array length
	topicLen := int(result[offset])<<8 | int(result[offset+1])
	resultTopic := string(result[offset+2 : offset+2+topicLen])
	assert.Equal(t, "tenant:my-topic", resultTopic)
}

func TestOffsetCommitRequestModifier_RequiresBothPrefixers(t *testing.T) {
	// Only group prefixer - should return nil
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
	}
	mod, err := GetRequestModifier(apiKeyOffsetCommit, 0, cfg)
	require.NoError(t, err)
	assert.Nil(t, mod, "should return nil without TopicPrefixer")

	// Only topic prefixer - should return nil
	cfg = RequestModifierConfig{
		TopicPrefixer: func(topic string) string { return "tenant:" + topic },
	}
	mod, err = GetRequestModifier(apiKeyOffsetCommit, 0, cfg)
	require.NoError(t, err)
	assert.Nil(t, mod, "should return nil without GroupPrefixer")
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetCommitRequestModifier -v`
Expected: FAIL

**Step 3: Add OffsetCommit request schema and modifier**

```go
type offsetCommitRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
	topicPrefixer TopicPrefixer
}

func (m *offsetCommitRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode offset commit request: %w", err)
	}

	if err := modifyOffsetCommitRequest(decoded, m.groupPrefixer, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify offset commit request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyOffsetCommitRequest(decoded *Struct, groupPrefixer GroupPrefixer, topicPrefixer TopicPrefixer) error {
	// Prefix group_id
	groupId := decoded.Get("group_id")
	if groupId != nil {
		if gid, ok := groupId.(string); ok && gid != "" {
			if err := decoded.Replace("group_id", groupPrefixer(gid)); err != nil {
				return err
			}
		}
	}

	// Prefix topic names
	topics := decoded.Get("topics")
	if topics == nil {
		return nil
	}

	topicsArray, ok := topics.([]interface{})
	if !ok {
		return nil
	}

	for _, topicElement := range topicsArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		nameField := topic.Get("name")
		if nameField == nil {
			continue
		}
		if name, ok := nameField.(string); ok && name != "" {
			if err := topic.Replace("name", topicPrefixer(name)); err != nil {
				return err
			}
		}
	}

	return nil
}

var offsetCommitRequestSchemaVersions = createOffsetCommitRequestSchemas()

func createOffsetCommitRequestSchemas() []Schema {
	partitionV0 := NewSchema("offset_commit_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_metadata", Ty: TypeNullableStr},
	)

	topicV0 := NewSchema("offset_commit_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	offsetCommitV0 := NewSchema("offset_commit_request_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v1 adds generation_id, member_id
	offsetCommitV1 := NewSchema("offset_commit_request_v1",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v2 adds retention_time_ms, removes timestamp from partitions
	offsetCommitV2 := NewSchema("offset_commit_request_v2",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "retention_time_ms", Ty: TypeInt64},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v5 removes retention_time_ms
	offsetCommitV5 := NewSchema("offset_commit_request_v5",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v6 adds committed_leader_epoch
	partitionV6 := NewSchema("offset_commit_partition_v6",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "committed_metadata", Ty: TypeNullableStr},
	)

	topicV6 := NewSchema("offset_commit_topic_v6",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV6},
	)

	offsetCommitV6 := NewSchema("offset_commit_request_v6",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV6},
	)

	// v7 adds group_instance_id
	offsetCommitV7 := NewSchema("offset_commit_request_v7",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Array{Name: "topics", Ty: topicV6},
	)

	// v8+ flexible
	partitionV8 := NewSchema("offset_commit_partition_v8",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "committed_metadata", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV8 := NewSchema("offset_commit_topic_v8",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV8},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetCommitV8 := NewSchema("offset_commit_request_v8",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&CompactArray{Name: "topics", Ty: topicV8},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		offsetCommitV0, // v0
		offsetCommitV1, // v1
		offsetCommitV2, // v2
		offsetCommitV2, // v3
		offsetCommitV2, // v4
		offsetCommitV5, // v5
		offsetCommitV6, // v6
		offsetCommitV7, // v7
		offsetCommitV8, // v8
		offsetCommitV8, // v9
	}
}

func getOffsetCommitRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(offsetCommitRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported OffsetCommit request version %d", apiVersion)
	}
	return offsetCommitRequestSchemaVersions[apiVersion], nil
}
```

Update `newOffsetCommitRequestModifier`:

```go
func newOffsetCommitRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	// Require both prefixers for consistency
	if cfg.GroupPrefixer == nil || cfg.TopicPrefixer == nil {
		return nil, nil
	}
	schema, err := getOffsetCommitRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &offsetCommitRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetCommitRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement OffsetCommit request modifier"
```

---

### Task 7: OffsetCommit Response Modifier

**Files:**
- Modify: `internal/proxy/protocol/responses.go`
- Test: `internal/proxy/protocol/responses_test.go`

**Step 1: Write failing test**

```go
func TestOffsetCommitResponseModifier_UnprefixesTopics(t *testing.T) {
	cfg := ResponseModifierConfig{
		TopicUnprefixer: func(topic string) string {
			if strings.HasPrefix(topic, "tenant:") {
				return strings.TrimPrefix(topic, "tenant:")
			}
			return topic
		},
	}

	mod, err := GetResponseModifierWithConfig(apiKeyOffsetCommit, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// OffsetCommit v0 response: topics[]
	topicName := "tenant:my-topic"
	var responseBytes []byte
	// topics array: length 1
	responseBytes = append(responseBytes, 0, 0, 0, 1)
	// topic name
	responseBytes = append(responseBytes, 0, byte(len(topicName)))
	responseBytes = append(responseBytes, []byte(topicName)...)
	// partitions array: length 1
	responseBytes = append(responseBytes, 0, 0, 0, 1)
	// partition_index: 0
	responseBytes = append(responseBytes, 0, 0, 0, 0)
	// error_code: 0
	responseBytes = append(responseBytes, 0, 0)

	result, err := mod.Apply(responseBytes)
	require.NoError(t, err)

	// Verify topic is unprefixed
	offset := 4 // array length
	topicLen := int(result[offset])<<8 | int(result[offset+1])
	resultTopic := string(result[offset+2 : offset+2+topicLen])
	assert.Equal(t, "my-topic", resultTopic)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetCommitResponseModifier -v`
Expected: FAIL

**Step 3: Add OffsetCommit response schema and modifier**

Add to `responses.go`:

```go
const apiKeyOffsetCommit = int16(8)

var offsetCommitResponseSchemaVersions = createOffsetCommitResponseSchemas()

func createOffsetCommitResponseSchemas() []Schema {
	partitionV0 := NewSchema("offset_commit_response_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	topicV0 := NewSchema("offset_commit_response_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	offsetCommitV0 := NewSchema("offset_commit_response_v0",
		&Array{Name: "topics", Ty: topicV0},
	)

	// v3 adds throttle_time_ms
	offsetCommitV3 := NewSchema("offset_commit_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v8+ flexible
	partitionV8 := NewSchema("offset_commit_response_partition_v8",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV8 := NewSchema("offset_commit_response_topic_v8",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV8},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetCommitV8 := NewSchema("offset_commit_response_v8",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "topics", Ty: topicV8},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		offsetCommitV0, // v0
		offsetCommitV0, // v1
		offsetCommitV0, // v2
		offsetCommitV3, // v3
		offsetCommitV3, // v4
		offsetCommitV3, // v5
		offsetCommitV3, // v6
		offsetCommitV3, // v7
		offsetCommitV8, // v8
		offsetCommitV8, // v9
	}
}

func modifyOffsetCommitResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	topics := decodedStruct.Get("topics")
	if topics == nil {
		return nil
	}

	topicsArray, ok := topics.([]interface{})
	if !ok {
		return nil
	}

	for _, topicElement := range topicsArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		nameField := topic.Get("name")
		if nameField == nil {
			continue
		}
		if name, ok := nameField.(string); ok && name != "" {
			unprefixed := cfg.TopicUnprefixer(name)
			if unprefixed != name {
				if err := topic.Replace("name", unprefixed); err != nil {
					return err
				}
			}
		}
	}

	return nil
}
```

Add to `GetResponseModifierWithConfig` switch:

```go
case apiKeyOffsetCommit:
	if cfg.TopicUnprefixer == nil {
		return nil, nil
	}
	return newResponseModifier(apiKey, apiVersion, cfg, offsetCommitResponseSchemaVersions, modifyOffsetCommitResponse)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetCommitResponseModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/responses.go internal/proxy/protocol/responses_test.go
git commit -m "feat(bifrost): implement OffsetCommit response modifier"
```

---

### Task 8: OffsetFetch Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestOffsetFetchRequestModifier_PrefixesGroupAndTopics(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
		TopicPrefixer: func(topic string) string { return "tenant:" + topic },
	}

	mod, err := GetRequestModifier(apiKeyOffsetFetch, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// OffsetFetch v0: group_id, topics[]
	groupId := "my-group"
	topicName := "my-topic"
	var requestBytes []byte
	// group_id
	requestBytes = append(requestBytes, 0, byte(len(groupId)))
	requestBytes = append(requestBytes, []byte(groupId)...)
	// topics array: length 1
	requestBytes = append(requestBytes, 0, 0, 0, 1)
	// topic name
	requestBytes = append(requestBytes, 0, byte(len(topicName)))
	requestBytes = append(requestBytes, []byte(topicName)...)
	// partitions array: length 1
	requestBytes = append(requestBytes, 0, 0, 0, 1)
	// partition_index: 0
	requestBytes = append(requestBytes, 0, 0, 0, 0)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	// Verify group_id is prefixed
	groupIdLen := int(result[0])<<8 | int(result[1])
	resultGroupId := string(result[2 : 2+groupIdLen])
	assert.Equal(t, "tenant:my-group", resultGroupId)

	// Verify topic is prefixed
	offset := 2 + groupIdLen + 4 // group_id + array length
	topicLen := int(result[offset])<<8 | int(result[offset+1])
	resultTopic := string(result[offset+2 : offset+2+topicLen])
	assert.Equal(t, "tenant:my-topic", resultTopic)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetFetchRequestModifier -v`
Expected: FAIL

**Step 3: Add OffsetFetch request schema and modifier**

```go
type offsetFetchRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
	topicPrefixer TopicPrefixer
}

func (m *offsetFetchRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode offset fetch request: %w", err)
	}

	if err := modifyOffsetFetchRequest(decoded, m.groupPrefixer, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify offset fetch request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyOffsetFetchRequest(decoded *Struct, groupPrefixer GroupPrefixer, topicPrefixer TopicPrefixer) error {
	// Prefix group_id
	groupId := decoded.Get("group_id")
	if groupId != nil {
		if gid, ok := groupId.(string); ok && gid != "" {
			if err := decoded.Replace("group_id", groupPrefixer(gid)); err != nil {
				return err
			}
		}
	}

	// Prefix topic names
	topics := decoded.Get("topics")
	if topics == nil {
		return nil
	}

	topicsArray, ok := topics.([]interface{})
	if !ok {
		return nil
	}

	for _, topicElement := range topicsArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		nameField := topic.Get("name")
		if nameField == nil {
			continue
		}
		if name, ok := nameField.(string); ok && name != "" {
			if err := topic.Replace("name", topicPrefixer(name)); err != nil {
				return err
			}
		}
	}

	return nil
}

var offsetFetchRequestSchemaVersions = createOffsetFetchRequestSchemas()

func createOffsetFetchRequestSchemas() []Schema {
	partitionV0 := NewSchema("offset_fetch_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
	)

	topicV0 := NewSchema("offset_fetch_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_indexes", Ty: partitionV0},
	)

	offsetFetchV0 := NewSchema("offset_fetch_request_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v2+ topics can be null to fetch all
	offsetFetchV2 := NewSchema("offset_fetch_request_v2",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0}, // nullable
	)

	// v6+ flexible
	partitionV6 := NewSchema("offset_fetch_partition_v6",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV6 := NewSchema("offset_fetch_topic_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partition_indexes", Ty: partitionV6},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetFetchV6 := NewSchema("offset_fetch_request_v6",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "topics", Ty: topicV6}, // nullable
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v7 adds require_stable
	offsetFetchV7 := NewSchema("offset_fetch_request_v7",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "topics", Ty: topicV6},
		&Mfield{Name: "require_stable", Ty: TypeBool},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v8+ batched groups
	groupV8 := NewSchema("offset_fetch_group_v8",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "topics", Ty: topicV6},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	offsetFetchV8 := NewSchema("offset_fetch_request_v8",
		&CompactArray{Name: "groups", Ty: groupV8},
		&Mfield{Name: "require_stable", Ty: TypeBool},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		offsetFetchV0, // v0
		offsetFetchV0, // v1
		offsetFetchV2, // v2
		offsetFetchV2, // v3
		offsetFetchV2, // v4
		offsetFetchV2, // v5
		offsetFetchV6, // v6
		offsetFetchV7, // v7
		offsetFetchV8, // v8
		offsetFetchV8, // v9
	}
}

func getOffsetFetchRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(offsetFetchRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported OffsetFetch request version %d", apiVersion)
	}
	return offsetFetchRequestSchemaVersions[apiVersion], nil
}
```

Update `newOffsetFetchRequestModifier`:

```go
func newOffsetFetchRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	// Require both prefixers for consistency
	if cfg.GroupPrefixer == nil || cfg.TopicPrefixer == nil {
		return nil, nil
	}
	schema, err := getOffsetFetchRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &offsetFetchRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetFetchRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement OffsetFetch request modifier"
```

---

### Task 9: OffsetFetch Response Modifier

**Files:**
- Modify: `internal/proxy/protocol/responses.go`
- Test: `internal/proxy/protocol/responses_test.go`

**Step 1: Write failing test**

```go
func TestOffsetFetchResponseModifier_UnprefixesTopics(t *testing.T) {
	cfg := ResponseModifierConfig{
		TopicUnprefixer: func(topic string) string {
			if strings.HasPrefix(topic, "tenant:") {
				return strings.TrimPrefix(topic, "tenant:")
			}
			return topic
		},
	}

	mod, err := GetResponseModifierWithConfig(apiKeyOffsetFetch, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// OffsetFetch v0 response: topics[]
	topicName := "tenant:my-topic"
	var responseBytes []byte
	// topics array: length 1
	responseBytes = append(responseBytes, 0, 0, 0, 1)
	// topic name
	responseBytes = append(responseBytes, 0, byte(len(topicName)))
	responseBytes = append(responseBytes, []byte(topicName)...)
	// partitions array: length 1
	responseBytes = append(responseBytes, 0, 0, 0, 1)
	// partition_index: 0
	responseBytes = append(responseBytes, 0, 0, 0, 0)
	// committed_offset: 100
	responseBytes = append(responseBytes, 0, 0, 0, 0, 0, 0, 0, 100)
	// metadata: empty
	responseBytes = append(responseBytes, 0, 0)
	// error_code: 0
	responseBytes = append(responseBytes, 0, 0)

	result, err := mod.Apply(responseBytes)
	require.NoError(t, err)

	// Verify topic is unprefixed
	offset := 4 // array length
	topicLen := int(result[offset])<<8 | int(result[offset+1])
	resultTopic := string(result[offset+2 : offset+2+topicLen])
	assert.Equal(t, "my-topic", resultTopic)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetFetchResponseModifier -v`
Expected: FAIL

**Step 3: Add OffsetFetch response schema and modifier**

```go
const apiKeyOffsetFetch = int16(9)

var offsetFetchResponseSchemaVersions = createOffsetFetchResponseSchemas()

func createOffsetFetchResponseSchemas() []Schema {
	partitionV0 := NewSchema("offset_fetch_response_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "metadata", Ty: TypeNullableStr},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	topicV0 := NewSchema("offset_fetch_response_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	offsetFetchV0 := NewSchema("offset_fetch_response_v0",
		&Array{Name: "topics", Ty: topicV0},
	)

	// v2 adds error_code at response level
	offsetFetchV2 := NewSchema("offset_fetch_response_v2",
		&Array{Name: "topics", Ty: topicV0},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// v3 adds throttle_time_ms
	offsetFetchV3 := NewSchema("offset_fetch_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// v5 adds committed_leader_epoch
	partitionV5 := NewSchema("offset_fetch_response_partition_v5",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "metadata", Ty: TypeNullableStr},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	topicV5 := NewSchema("offset_fetch_response_topic_v5",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV5},
	)

	offsetFetchV5 := NewSchema("offset_fetch_response_v5",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV5},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// v6+ flexible
	partitionV6 := NewSchema("offset_fetch_response_partition_v6",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "metadata", Ty: TypeCompactNullableStr},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV6 := NewSchema("offset_fetch_response_topic_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV6},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetFetchV6 := NewSchema("offset_fetch_response_v6",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "topics", Ty: topicV6},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	// v8+ batched groups
	groupV8 := NewSchema("offset_fetch_response_group_v8",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "topics", Ty: topicV6},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	offsetFetchV8 := NewSchema("offset_fetch_response_v8",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "groups", Ty: groupV8},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		offsetFetchV0, // v0
		offsetFetchV0, // v1
		offsetFetchV2, // v2
		offsetFetchV3, // v3
		offsetFetchV3, // v4
		offsetFetchV5, // v5
		offsetFetchV6, // v6
		offsetFetchV6, // v7
		offsetFetchV8, // v8
		offsetFetchV8, // v9
	}
}

func modifyOffsetFetchResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	// Handle v0-v7 format (direct topics array)
	topics := decodedStruct.Get("topics")
	if topics != nil {
		if err := unprefixTopicsInArray(topics, cfg.TopicUnprefixer); err != nil {
			return err
		}
	}

	// Handle v8+ format (groups array with nested topics)
	groups := decodedStruct.Get("groups")
	if groups != nil {
		groupsArray, ok := groups.([]interface{})
		if ok {
			for _, groupElement := range groupsArray {
				group, ok := groupElement.(*Struct)
				if !ok {
					continue
				}
				groupTopics := group.Get("topics")
				if groupTopics != nil {
					if err := unprefixTopicsInArray(groupTopics, cfg.TopicUnprefixer); err != nil {
						return err
					}
				}
			}
		}
	}

	return nil
}

func unprefixTopicsInArray(topics interface{}, unprefixer TopicUnprefixer) error {
	topicsArray, ok := topics.([]interface{})
	if !ok {
		return nil
	}

	for _, topicElement := range topicsArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		nameField := topic.Get("name")
		if nameField == nil {
			continue
		}
		if name, ok := nameField.(string); ok && name != "" {
			unprefixed := unprefixer(name)
			if unprefixed != name {
				if err := topic.Replace("name", unprefixed); err != nil {
					return err
				}
			}
		}
	}

	return nil
}
```

Add to `GetResponseModifierWithConfig` switch:

```go
case apiKeyOffsetFetch:
	if cfg.TopicUnprefixer == nil {
		return nil, nil
	}
	return newResponseModifier(apiKey, apiVersion, cfg, offsetFetchResponseSchemaVersions, modifyOffsetFetchResponse)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestOffsetFetchResponseModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/responses.go internal/proxy/protocol/responses_test.go
git commit -m "feat(bifrost): implement OffsetFetch response modifier"
```

---

## Phase 3: Group Management

### Task 10: Add GroupUnprefixer and GroupFilter to ResponseModifierConfig

**Files:**
- Modify: `internal/proxy/protocol/responses.go`
- Modify: `internal/proxy/bifrost_proxy.go`

**Step 1: Update ResponseModifierConfig**

Add to `ResponseModifierConfig` struct in `responses.go`:

```go
type ResponseModifierConfig struct {
	NetAddressMappingFunc config.NetAddressMappingFunc
	TopicUnprefixer       TopicUnprefixer
	TopicFilter           TopicFilter
	GroupUnprefixer       func(group string) string  // NEW
	GroupFilter           func(group string) bool    // NEW
}
```

**Step 2: Wire up in bifrost_proxy.go**

Add after topicFilter definition:

```go
// Group unprefixer: removes tenant prefix from incoming groups
groupUnprefixer := func(group string) string {
	unprefixed, _ := bifrostConn.rewriter.UnprefixGroup(group)
	return unprefixed
}
// Group filter: only include groups belonging to this tenant
groupFilter := func(group string) bool {
	_, ok := bifrostConn.rewriter.UnprefixGroup(group)
	return ok
}
```

Update responseModifierConfig:

```go
responseModifierConfig := &protocol.ResponseModifierConfig{
	NetAddressMappingFunc: advertisedMapper,
	TopicUnprefixer:       topicUnprefixer,
	TopicFilter:           topicFilter,
	GroupUnprefixer:       groupUnprefixer,
	GroupFilter:           groupFilter,
}
```

**Step 3: Run tests to verify nothing breaks**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/... -v`
Expected: PASS

**Step 4: Commit**

```bash
git add internal/proxy/protocol/responses.go internal/proxy/bifrost_proxy.go
git commit -m "feat(bifrost): add GroupUnprefixer and GroupFilter to response config"
```

---

### Task 11: DescribeGroups Request Modifier

**Files:**
- Modify: `internal/proxy/protocol/requests.go`
- Test: `internal/proxy/protocol/requests_test.go`

**Step 1: Write failing test**

```go
func TestDescribeGroupsRequestModifier_PrefixesGroupIds(t *testing.T) {
	cfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return "tenant:" + group },
	}

	mod, err := GetRequestModifier(apiKeyDescribeGroups, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// DescribeGroups v0: groups[] (array of strings)
	group1 := "group-1"
	group2 := "group-2"
	var requestBytes []byte
	// groups array: length 2
	requestBytes = append(requestBytes, 0, 0, 0, 2)
	// group 1
	requestBytes = append(requestBytes, 0, byte(len(group1)))
	requestBytes = append(requestBytes, []byte(group1)...)
	// group 2
	requestBytes = append(requestBytes, 0, byte(len(group2)))
	requestBytes = append(requestBytes, []byte(group2)...)

	result, err := mod.Apply(requestBytes)
	require.NoError(t, err)

	// Parse result and verify both groups are prefixed
	offset := 4 // array length
	g1Len := int(result[offset])<<8 | int(result[offset+1])
	g1 := string(result[offset+2 : offset+2+g1Len])
	assert.Equal(t, "tenant:group-1", g1)

	offset = offset + 2 + g1Len
	g2Len := int(result[offset])<<8 | int(result[offset+1])
	g2 := string(result[offset+2 : offset+2+g2Len])
	assert.Equal(t, "tenant:group-2", g2)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestDescribeGroupsRequestModifier -v`
Expected: FAIL

**Step 3: Add DescribeGroups request schema and modifier**

```go
type describeGroupsRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *describeGroupsRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode describe groups request: %w", err)
	}

	if err := modifyDescribeGroupsRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify describe groups request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyDescribeGroupsRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groups := decoded.Get("groups")
	if groups == nil {
		return nil
	}

	groupsArray, ok := groups.([]interface{})
	if !ok {
		return nil
	}

	for i, groupElement := range groupsArray {
		if group, ok := groupElement.(string); ok && group != "" {
			groupsArray[i] = prefixer(group)
		}
	}

	return decoded.Replace("groups", groupsArray)
}

var describeGroupsRequestSchemaVersions = createDescribeGroupsRequestSchemas()

func createDescribeGroupsRequestSchemas() []Schema {
	describeGroupsV0 := NewSchema("describe_groups_request_v0",
		&Array{Name: "groups", Ty: TypeStr},
	)

	// v3 adds include_authorized_operations
	describeGroupsV3 := NewSchema("describe_groups_request_v3",
		&Array{Name: "groups", Ty: TypeStr},
		&Mfield{Name: "include_authorized_operations", Ty: TypeBool},
	)

	// v5+ flexible
	describeGroupsV5 := NewSchema("describe_groups_request_v5",
		&CompactArray{Name: "groups", Ty: TypeCompactStr},
		&Mfield{Name: "include_authorized_operations", Ty: TypeBool},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		describeGroupsV0, // v0
		describeGroupsV0, // v1
		describeGroupsV0, // v2
		describeGroupsV3, // v3
		describeGroupsV3, // v4
		describeGroupsV5, // v5
	}
}

func getDescribeGroupsRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(describeGroupsRequestSchemaVersions) {
		return nil, fmt.Errorf("unsupported DescribeGroups request version %d", apiVersion)
	}
	return describeGroupsRequestSchemaVersions[apiVersion], nil
}
```

Update `newDescribeGroupsRequestModifier`:

```go
func newDescribeGroupsRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getDescribeGroupsRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &describeGroupsRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestDescribeGroupsRequestModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/requests.go internal/proxy/protocol/requests_test.go
git commit -m "feat(bifrost): implement DescribeGroups request modifier"
```

---

### Task 12: DescribeGroups Response Modifier

**Files:**
- Modify: `internal/proxy/protocol/responses.go`
- Test: `internal/proxy/protocol/responses_test.go`

**Step 1: Write failing test**

```go
func TestDescribeGroupsResponseModifier_UnprefixesGroupIds(t *testing.T) {
	cfg := ResponseModifierConfig{
		GroupUnprefixer: func(group string) string {
			if strings.HasPrefix(group, "tenant:") {
				return strings.TrimPrefix(group, "tenant:")
			}
			return group
		},
	}

	mod, err := GetResponseModifierWithConfig(apiKeyDescribeGroups, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// Build minimal DescribeGroups v0 response
	groupId := "tenant:my-group"
	groupState := "Stable"
	protocolType := "consumer"
	protocol := "range"
	var responseBytes []byte
	// groups array: length 1
	responseBytes = append(responseBytes, 0, 0, 0, 1)
	// error_code: 0
	responseBytes = append(responseBytes, 0, 0)
	// group_id
	responseBytes = append(responseBytes, 0, byte(len(groupId)))
	responseBytes = append(responseBytes, []byte(groupId)...)
	// group_state
	responseBytes = append(responseBytes, 0, byte(len(groupState)))
	responseBytes = append(responseBytes, []byte(groupState)...)
	// protocol_type
	responseBytes = append(responseBytes, 0, byte(len(protocolType)))
	responseBytes = append(responseBytes, []byte(protocolType)...)
	// protocol
	responseBytes = append(responseBytes, 0, byte(len(protocol)))
	responseBytes = append(responseBytes, []byte(protocol)...)
	// members: empty array
	responseBytes = append(responseBytes, 0, 0, 0, 0)

	result, err := mod.Apply(responseBytes)
	require.NoError(t, err)

	// Parse and verify group_id is unprefixed
	// Skip: array_len(4) + error_code(2)
	offset := 6
	gidLen := int(result[offset])<<8 | int(result[offset+1])
	gid := string(result[offset+2 : offset+2+gidLen])
	assert.Equal(t, "my-group", gid)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestDescribeGroupsResponseModifier -v`
Expected: FAIL

**Step 3: Add DescribeGroups response schema and modifier**

```go
const apiKeyDescribeGroups = int16(15)

var describeGroupsResponseSchemaVersions = createDescribeGroupsResponseSchemas()

func createDescribeGroupsResponseSchemas() []Schema {
	memberV0 := NewSchema("describe_groups_member_v0",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "client_id", Ty: TypeStr},
		&Mfield{Name: "client_host", Ty: TypeStr},
		&Mfield{Name: "member_metadata", Ty: TypeBytes},
		&Mfield{Name: "member_assignment", Ty: TypeBytes},
	)

	groupV0 := NewSchema("describe_groups_group_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "group_state", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Mfield{Name: "protocol_data", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV0},
	)

	describeGroupsV0 := NewSchema("describe_groups_response_v0",
		&Array{Name: "groups", Ty: groupV0},
	)

	// v1 adds throttle_time_ms
	describeGroupsV1 := NewSchema("describe_groups_response_v1",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "groups", Ty: groupV0},
	)

	// v3 adds authorized_operations
	groupV3 := NewSchema("describe_groups_group_v3",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "group_state", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Mfield{Name: "protocol_data", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV0},
		&Mfield{Name: "authorized_operations", Ty: TypeInt32},
	)

	describeGroupsV3 := NewSchema("describe_groups_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "groups", Ty: groupV3},
	)

	// v4 adds group_instance_id to members
	memberV4 := NewSchema("describe_groups_member_v4",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Mfield{Name: "client_id", Ty: TypeStr},
		&Mfield{Name: "client_host", Ty: TypeStr},
		&Mfield{Name: "member_metadata", Ty: TypeBytes},
		&Mfield{Name: "member_assignment", Ty: TypeBytes},
	)

	groupV4 := NewSchema("describe_groups_group_v4",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "group_state", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Mfield{Name: "protocol_data", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV4},
		&Mfield{Name: "authorized_operations", Ty: TypeInt32},
	)

	describeGroupsV4 := NewSchema("describe_groups_response_v4",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "groups", Ty: groupV4},
	)

	// v5+ flexible
	memberV5 := NewSchema("describe_groups_member_v5",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "client_id", Ty: TypeCompactStr},
		&Mfield{Name: "client_host", Ty: TypeCompactStr},
		&Mfield{Name: "member_metadata", Ty: TypeCompactBytes},
		&Mfield{Name: "member_assignment", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "member_tagged_fields"},
	)

	groupV5 := NewSchema("describe_groups_group_v5",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_state", Ty: TypeCompactStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&Mfield{Name: "protocol_data", Ty: TypeCompactStr},
		&CompactArray{Name: "members", Ty: memberV5},
		&Mfield{Name: "authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	describeGroupsV5 := NewSchema("describe_groups_response_v5",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "groups", Ty: groupV5},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		describeGroupsV0, // v0
		describeGroupsV1, // v1
		describeGroupsV1, // v2
		describeGroupsV3, // v3
		describeGroupsV4, // v4
		describeGroupsV5, // v5
	}
}

func modifyDescribeGroupsResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.GroupUnprefixer == nil {
		return nil
	}

	groups := decodedStruct.Get("groups")
	if groups == nil {
		return nil
	}

	groupsArray, ok := groups.([]interface{})
	if !ok {
		return nil
	}

	for _, groupElement := range groupsArray {
		group, ok := groupElement.(*Struct)
		if !ok {
			continue
		}
		groupId := group.Get("group_id")
		if groupId == nil {
			continue
		}
		if gid, ok := groupId.(string); ok && gid != "" {
			unprefixed := cfg.GroupUnprefixer(gid)
			if unprefixed != gid {
				if err := group.Replace("group_id", unprefixed); err != nil {
					return err
				}
			}
		}
	}

	return nil
}
```

Add to `GetResponseModifierWithConfig` switch:

```go
case apiKeyDescribeGroups:
	if cfg.GroupUnprefixer == nil {
		return nil, nil
	}
	return newResponseModifier(apiKey, apiVersion, cfg, describeGroupsResponseSchemaVersions, modifyDescribeGroupsResponse)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestDescribeGroupsResponseModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/responses.go internal/proxy/protocol/responses_test.go
git commit -m "feat(bifrost): implement DescribeGroups response modifier"
```

---

### Task 13: ListGroups Response Modifier

**Files:**
- Modify: `internal/proxy/protocol/responses.go`
- Test: `internal/proxy/protocol/responses_test.go`

**Step 1: Write failing test**

```go
func TestListGroupsResponseModifier_FiltersAndUnprefixesGroups(t *testing.T) {
	cfg := ResponseModifierConfig{
		GroupUnprefixer: func(group string) string {
			if strings.HasPrefix(group, "tenant:") {
				return strings.TrimPrefix(group, "tenant:")
			}
			return group
		},
		GroupFilter: func(group string) bool {
			return strings.HasPrefix(group, "tenant:")
		},
	}

	mod, err := GetResponseModifierWithConfig(apiKeyListGroups, 0, cfg)
	require.NoError(t, err)
	require.NotNil(t, mod)

	// Build ListGroups v0 response with 3 groups (2 match filter)
	var responseBytes []byte
	// error_code: 0
	responseBytes = append(responseBytes, 0, 0)
	// groups array: length 3
	responseBytes = append(responseBytes, 0, 0, 0, 3)

	// Group 1: tenant:my-group (should be included, unprefixed)
	g1 := "tenant:my-group"
	pt1 := "consumer"
	responseBytes = append(responseBytes, 0, byte(len(g1)))
	responseBytes = append(responseBytes, []byte(g1)...)
	responseBytes = append(responseBytes, 0, byte(len(pt1)))
	responseBytes = append(responseBytes, []byte(pt1)...)

	// Group 2: other:their-group (should be filtered out)
	g2 := "other:their-group"
	pt2 := "consumer"
	responseBytes = append(responseBytes, 0, byte(len(g2)))
	responseBytes = append(responseBytes, []byte(g2)...)
	responseBytes = append(responseBytes, 0, byte(len(pt2)))
	responseBytes = append(responseBytes, []byte(pt2)...)

	// Group 3: tenant:another-group (should be included, unprefixed)
	g3 := "tenant:another-group"
	pt3 := "consumer"
	responseBytes = append(responseBytes, 0, byte(len(g3)))
	responseBytes = append(responseBytes, []byte(g3)...)
	responseBytes = append(responseBytes, 0, byte(len(pt3)))
	responseBytes = append(responseBytes, []byte(pt3)...)

	result, err := mod.Apply(responseBytes)
	require.NoError(t, err)

	// Parse result: should have 2 groups
	// error_code(2) + array_len(4)
	arrayLen := int(result[2])<<24 | int(result[3])<<16 | int(result[4])<<8 | int(result[5])
	assert.Equal(t, 2, arrayLen, "should have 2 groups after filtering")

	// First group should be "my-group" (unprefixed)
	offset := 6
	gLen := int(result[offset])<<8 | int(result[offset+1])
	resultG := string(result[offset+2 : offset+2+gLen])
	assert.Equal(t, "my-group", resultG)
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestListGroupsResponseModifier -v`
Expected: FAIL

**Step 3: Add ListGroups response schema and modifier**

```go
const apiKeyListGroups = int16(16)

var listGroupsResponseSchemaVersions = createListGroupsResponseSchemas()

func createListGroupsResponseSchemas() []Schema {
	groupV0 := NewSchema("list_groups_group_v0",
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
	)

	listGroupsV0 := NewSchema("list_groups_response_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Array{Name: "groups", Ty: groupV0},
	)

	// v1 adds throttle_time_ms
	listGroupsV1 := NewSchema("list_groups_response_v1",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Array{Name: "groups", Ty: groupV0},
	)

	// v3+ flexible
	groupV3 := NewSchema("list_groups_group_v3",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	listGroupsV3 := NewSchema("list_groups_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&CompactArray{Name: "groups", Ty: groupV3},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	// v4 adds group_state
	groupV4 := NewSchema("list_groups_group_v4",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&Mfield{Name: "group_state", Ty: TypeCompactStr},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	listGroupsV4 := NewSchema("list_groups_response_v4",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&CompactArray{Name: "groups", Ty: groupV4},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		listGroupsV0, // v0
		listGroupsV1, // v1
		listGroupsV1, // v2
		listGroupsV3, // v3
		listGroupsV4, // v4
	}
}

func modifyListGroupsResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	groups := decodedStruct.Get("groups")
	if groups == nil {
		return nil
	}

	groupsArray, ok := groups.([]interface{})
	if !ok {
		return nil
	}

	// Filter and unprefix groups
	var filteredGroups []interface{}
	if cfg.GroupFilter != nil {
		filteredGroups = make([]interface{}, 0, len(groupsArray))
	}

	for _, groupElement := range groupsArray {
		group, ok := groupElement.(*Struct)
		if !ok {
			continue
		}
		groupId := group.Get("group_id")
		if groupId == nil {
			if cfg.GroupFilter == nil {
				continue
			}
			filteredGroups = append(filteredGroups, groupElement)
			continue
		}

		gid, ok := groupId.(string)
		if !ok || gid == "" {
			if cfg.GroupFilter == nil {
				continue
			}
			filteredGroups = append(filteredGroups, groupElement)
			continue
		}

		// Apply filter
		if cfg.GroupFilter != nil && !cfg.GroupFilter(gid) {
			continue // Skip groups not belonging to tenant
		}

		// Apply unprefixer
		if cfg.GroupUnprefixer != nil {
			unprefixed := cfg.GroupUnprefixer(gid)
			if unprefixed != gid {
				if err := group.Replace("group_id", unprefixed); err != nil {
					return err
				}
			}
		}

		if cfg.GroupFilter != nil {
			filteredGroups = append(filteredGroups, groupElement)
		}
	}

	// Replace groups array if filtering was applied
	if cfg.GroupFilter != nil {
		if err := decodedStruct.Replace("groups", filteredGroups); err != nil {
			return err
		}
	}

	return nil
}
```

Add to `GetResponseModifierWithConfig` switch:

```go
case apiKeyListGroups:
	if cfg.GroupUnprefixer == nil && cfg.GroupFilter == nil {
		return nil, nil
	}
	return newResponseModifier(apiKey, apiVersion, cfg, listGroupsResponseSchemaVersions, modifyListGroupsResponse)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/protocol/... -run TestListGroupsResponseModifier -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/proxy/protocol/responses.go internal/proxy/protocol/responses_test.go
git commit -m "feat(bifrost): implement ListGroups response modifier with filtering"
```

---

## Phase 4: Testing

### Task 14: Run All Unit Tests

**Step 1: Run full test suite**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./... -v -count=1`
Expected: All tests PASS

**Step 2: Commit if any test fixes needed**

---

### Task 15: Consumer Group Integration Test

**Files:**
- Create: `internal/proxy/consumer_group_integration_test.go`

**Step 1: Write integration test**

```go
package proxy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

func TestConsumerGroup_EndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	// Skip if not running with Docker
	// This test requires Bifrost and Redpanda to be running
	ctx := context.Background()

	// Connect to Bifrost admin API
	grpcConn, err := grpc.Dial("localhost:50060", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Skipf("Bifrost admin API not available: %v", err)
	}
	defer grpcConn.Close()

	adminClient := gatewayv1.NewBifrostAdminServiceClient(grpcConn)

	// Setup
	username := "cg-test-user"
	password := "cg-test-pass"
	vcID := "vc-cg-test"
	topicPrefix := "cg-test-"
	groupPrefix := "cg-test-"
	testTopic := "test-topic"
	testGroup := "test-consumer-group"

	// Create virtual cluster
	_, err = adminClient.UpsertVirtualCluster(ctx, &gatewayv1.UpsertVirtualClusterRequest{
		Config: &gatewayv1.VirtualClusterConfig{
			Id:                       vcID,
			TopicPrefix:              topicPrefix,
			GroupPrefix:              groupPrefix,
			TransactionIdPrefix:      topicPrefix,
			PhysicalBootstrapServers: "redpanda:9092",
			AdvertisedHost:           "localhost",
			AdvertisedPort:           9092,
		},
	})
	require.NoError(t, err)
	defer adminClient.DeleteVirtualCluster(ctx, &gatewayv1.DeleteVirtualClusterRequest{VirtualClusterId: vcID})

	// Create credential
	_, err = adminClient.UpsertCredential(ctx, &gatewayv1.UpsertCredentialRequest{
		Config: &gatewayv1.CredentialConfig{
			Id:               "cg-cred-1",
			Username:         username,
			PasswordHash:     hashPassword(password),
			VirtualClusterId: vcID,
		},
	})
	require.NoError(t, err)
	defer adminClient.RevokeCredential(ctx, &gatewayv1.RevokeCredentialRequest{CredentialId: "cg-cred-1"})

	time.Sleep(500 * time.Millisecond)

	// Produce some messages directly to prefixed topic
	directProducer, err := kgo.NewClient(
		kgo.SeedBrokers("localhost:19092"),
		kgo.DefaultProduceTopic(topicPrefix+testTopic),
		kgo.AllowAutoTopicCreation(),
	)
	require.NoError(t, err)

	for i := 0; i < 5; i++ {
		results := directProducer.ProduceSync(ctx, &kgo.Record{
			Value: []byte(fmt.Sprintf("message-%d", i)),
		})
		require.NoError(t, results.FirstErr())
	}
	directProducer.Flush(ctx)
	directProducer.Close()

	// Connect consumer through Bifrost with consumer group
	consumer, err := kgo.NewClient(
		kgo.SeedBrokers("localhost:9092"),
		kgo.SASL(plain.Auth{
			User: username,
			Pass: password,
		}.AsMechanism()),
		kgo.ConsumerGroup(testGroup),
		kgo.ConsumeTopics(testTopic),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
	)
	require.NoError(t, err)
	defer consumer.Close()

	// Poll for messages (this triggers JoinGroup, SyncGroup, etc.)
	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var receivedMessages []string
	for len(receivedMessages) < 5 {
		fetches := consumer.PollFetches(pollCtx)
		if errs := fetches.Errors(); len(errs) > 0 {
			for _, e := range errs {
				if e.Err == context.DeadlineExceeded {
					break
				}
				t.Logf("Fetch error: %v", e.Err)
			}
		}
		for _, record := range fetches.Records() {
			receivedMessages = append(receivedMessages, string(record.Value))
			// Verify topic name is unprefixed
			assert.Equal(t, testTopic, record.Topic, "topic should be unprefixed")
		}
		if pollCtx.Err() != nil {
			break
		}
	}

	assert.GreaterOrEqual(t, len(receivedMessages), 5, "should receive all messages")

	// Commit offsets (tests OffsetCommit)
	err = consumer.CommitUncommittedOffsets(ctx)
	require.NoError(t, err)

	// Verify group exists on upstream with prefixed name
	directAdmin, err := kgo.NewClient(kgo.SeedBrokers("localhost:19092"))
	require.NoError(t, err)
	defer directAdmin.Close()

	// Use admin client to list groups and verify prefixed name exists
	// (This would require kadm package, so we'll skip the verification for now)

	t.Log("Consumer group integration test passed!")
}
```

**Step 2: Run integration test**

Run: `cd /Users/drew.payment/dev/orbit/services/bifrost && go test ./internal/proxy/... -run TestConsumerGroup_EndToEnd -v -count=1`
Expected: PASS (or SKIP if Docker not available)

**Step 3: Commit**

```bash
git add internal/proxy/consumer_group_integration_test.go
git commit -m "test(bifrost): add consumer group integration test"
```

---

## Summary

This plan implements full consumer group API support for Bifrost:

**Phase 1 (Tasks 1-5):** Core consumer group flow
- JoinGroup, SyncGroup, Heartbeat, LeaveGroup request modifiers
- FindCoordinator request modifier with key_type awareness

**Phase 2 (Tasks 6-9):** Offset management
- OffsetCommit request/response modifiers
- OffsetFetch request/response modifiers

**Phase 3 (Tasks 10-13):** Group management
- GroupUnprefixer/GroupFilter config
- DescribeGroups request/response modifiers
- ListGroups response modifier with filtering

**Phase 4 (Tasks 14-15):** Testing
- Full unit test suite
- End-to-end integration test

Total: 15 tasks, each with TDD approach (test first, implement, verify, commit).
