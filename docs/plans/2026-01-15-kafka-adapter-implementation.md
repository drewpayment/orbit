# Apache Kafka Adapter Implementation

**Date:** 2026-01-15
**Status:** Design Complete

## Overview

Implement the remaining methods in the Apache Kafka adapter (`services/kafka/internal/adapters/apache/client.go`) to support production Kafka clusters with SASL/TLS authentication.

## Current State

Already implemented:
- `ValidateConnection` - Tests cluster connectivity
- `CreateTopic` - Creates topics with config
- `DeleteTopic` - Deletes topics
- `ListTopics` - Lists non-internal topics

Returning `ErrNotConfigured`:
- `DescribeTopic`, `UpdateTopicConfig`
- `CreateACL`, `DeleteACL`, `ListACLs`
- `GetTopicMetrics`, `GetConsumerGroupLag`, `ListConsumerGroups`

## Design Decisions

1. **SASL/TLS**: Support PLAIN, SCRAM-SHA-256, SCRAM-SHA-512 mechanisms with optional TLS
2. **Metrics**: Use Kafka Admin API only (no JMX). Throughput metrics deferred to Prometheus
3. **Testing**: Unit tests for mappings, integration tests against Redpanda

## Section 1: SASL/TLS Authentication

Add to `newKgoClient()`:

```go
// SASL configuration
if c.config.SASLUsername != "" {
    var mechanism sasl.Mechanism
    switch c.config.SASLMechanism {
    case "PLAIN":
        mechanism = plain.Auth{User: username, Pass: password}.AsMechanism()
    case "SCRAM-SHA-256":
        mechanism = scram.Auth{User: username, Pass: password}.AsSha256Mechanism()
    case "SCRAM-SHA-512":
        mechanism = scram.Auth{User: username, Pass: password}.AsSha512Mechanism()
    }
    opts = append(opts, kgo.SASL(mechanism))
}

// TLS configuration
if c.config.TLSEnabled || strings.HasSuffix(c.config.SecurityProtocol, "SSL") {
    tlsConfig := &tls.Config{InsecureSkipVerify: c.config.TLSSkipVerify}
    opts = append(opts, kgo.DialTLSConfig(tlsConfig))
}
```

Config struct addition:
- `TLSCACert string` - Optional PEM-encoded CA certificate

## Section 2: Core Operations

**DescribeTopic:**
- Use `kadm.ListTopics(ctx, topicName)` for partition/replication info
- Use `kadm.DescribeTopicConfigs()` for config values
- Return `adapters.ErrTopicNotFound` if topic doesn't exist

**UpdateTopicConfig:**
- Convert config map to `[]kadm.AlterConfig`
- Call `AlterTopicConfigs` with incremental=false
- Check response for per-config errors

**ListConsumerGroups:**
- Use `kadm.ListGroups()` to get all groups
- Use `kadm.DescribeGroups()` for state/protocol details
- Map to `adapters.ConsumerGroupInfo` structs

**GetConsumerGroupLag:**
- Use `kadm.Lag(ctx, groupID)` for per-partition lag
- Aggregate by topic, calculate total lag
- Get group state via `DescribeGroups`

## Section 3: ACL Operations

**CreateACL:**
```go
b := kadm.NewACLs().
    Allow(acl.Principal).
    ResourcePatternType(mapPatternType(acl.PatternType)).
    Topics(acl.ResourceName).
    Operations(mapOperation(acl.Operation))
results, err := adminClient.CreateACLs(ctx, b)
```

**DeleteACL:**
- Build ACL filter matching the spec
- Call `DeleteACLs`, verify at least one deleted

**ListACLs:**
- `DescribeACLs` with nil filter returns all
- Map `kadm.DescribedACL` to `adapters.ACLInfo`

**Helper functions:**
- `mapResourceType()` - adapters.ResourceType → kadm constants
- `mapPatternType()` - adapters.PatternType → kadm constants
- `mapOperation()` - adapters.ACLOperation → kadm constants
- `mapPermissionType()` - ALLOW/DENY handling

## Section 4: Error Handling & Testing

**Error handling:**
- Wrap errors with context: `fmt.Errorf("failed to describe topic %s: %w", topicName, err)`
- Return `adapters.ErrTopicNotFound` for missing topics
- Handle clusters that restrict ACL operations

**Testing:**

Unit tests (no Kafka):
- Config validation
- Helper function mappings
- Error wrapping

Integration tests (`//go:build integration`):
- Use Redpanda from docker-compose
- Topic lifecycle: create → describe → update config → delete
- ACL lifecycle: create → list → delete
- Consumer group: list groups → get lag

**File structure:**
```
services/kafka/internal/adapters/apache/
├── client.go                    # Main implementation
├── client_test.go               # Unit tests
├── client_integration_test.go   # Integration tests
├── sasl.go                      # SASL/TLS helpers
└── mappers.go                   # Type mapping helpers
```

## Implementation Order

1. SASL/TLS authentication (enables production use)
2. Type mappers (needed by all operations)
3. DescribeTopic, UpdateTopicConfig
4. ListConsumerGroups, GetConsumerGroupLag
5. CreateACL, DeleteACL, ListACLs
6. GetTopicMetrics (limited - partition/replica counts only)
7. Integration tests
