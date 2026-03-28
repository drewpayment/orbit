# Kafka Message Browser & Producer — QA Plan

**Date:** 2026-03-28
**Author:** Bill (QA Expert)
**Based on:** [Design Document](./2026-03-28-kafka-message-browser-design.md), [Implementation Plan](./2026-03-28-kafka-message-browser-implementation.md)
**Branch:** `feat/kafka-message-browser`

---

## 1. QA Strategy Overview

This feature spans three services (Bifrost, Kafka service, Next.js frontend) across four phases. The QA strategy focuses on:

1. **Contract integrity** — proto definitions are the source of truth; both Go and TypeScript must stay in sync
2. **Access control coverage** — the message browser introduces new permission surfaces (browse + produce per ownership/share level)
3. **Data safety** — temporary consumers must not leak; produce operations must be authorized
4. **Performance gates** — browse < 2s for 50 messages, produce < 1s, zero bundle impact from lazy loading
5. **Adapter migration confidence** — the Bifrost adapter swap must not break existing topic CRUD operations

---

## 2. QA Concerns and Mitigations

### Concern 1: Temporary Consumer Leak in Bifrost (Phase A) — HIGH

**Issue:** `BrowseMessages` creates a temporary Kafka consumer per request with no consumer group. If the handler panics, times out, or the gRPC connection drops mid-fetch, the consumer may not be cleaned up. Leaked consumers accumulate broker connections.

**Mitigation:**
- Verify `defer client.Close()` is present in the `BrowseMessages` handler
- Add a context timeout to the consumer lifecycle (e.g., 30s max, matching the design doc's <2s target with margin)
- Test: cancel the gRPC context mid-browse and verify the consumer is cleaned up (no lingering connections in Redpanda admin)

**Verification:**
```bash
# Before browse: count client connections
rpk cluster health | grep connections
# Trigger 10 browse requests, cancel 5 mid-flight
# After: connection count should return to pre-test baseline within 30s
```

---

### Concern 2: Adapter Migration Breaks Existing Operations (Phase B) — HIGH

**Issue:** Swapping `apache/client.go` for `bifrost/client.go` changes the implementation of all 11 adapter methods simultaneously. A subtle difference in prefix handling, error codes, or response format could break existing topic CRUD, ACL management, or consumer group operations.

**Mitigation:**
- Run the full existing Kafka service test suite after the swap (not just the new adapter tests)
- Run the 32 topic sharing integration tests from Wave 4 of tech debt — these exercise the critical path
- Add a specific regression test: create topic via old adapter, swap to new adapter, verify topic is still accessible

**Verification checkpoint:**
```bash
# After Phase B swap:
cd services/kafka && go test ./...                           # All unit tests
cd services/kafka && go test -tags=integration ./...         # All integration tests
cd orbit-www && bun run vitest run src/app/actions/kafka-topic-catalog.integration.test.ts  # 32 sharing tests
```

---

### Concern 3: Access Control Bypass via Direct Bifrost Call (Phase A/C) — HIGH

**Issue:** Bifrost's new `BrowseMessages` and `ProduceMessage` RPCs are "dumb" broker operations with no auth. If Bifrost's admin port (50060) is exposed beyond the internal Docker network, any client could browse/produce without access checks.

**Mitigation:**
- Verify Bifrost admin port is NOT exposed in `docker-compose.yml` `ports:` section (internal-only)
- Verify the Kafka service is the only caller of Bifrost admin RPCs
- Add a test: call Bifrost `BrowseMessages` directly (bypassing Kafka service) — should only be reachable from within the Docker network

**Verification:**
```bash
# From host machine (should fail):
grpcurl -plaintext localhost:50060 idp.gateway.v1.BifrostAdminService/BrowseMessages
# Expected: connection refused (port not mapped) or "not exposed"
```

---

### Concern 4: Produce Without Write Permission (Phase C) — HIGH

**Issue:** The access control flow checks share permissions before delegating to Bifrost. If the `canProduce` check has a logic error (e.g., `read` share incorrectly grants write), unauthorized users could produce messages.

**Mitigation:**
- Test all 6 permission combinations explicitly:

| User Type | Share Permission | Expected Browse | Expected Produce |
|-----------|-----------------|----------------|-----------------|
| Topic owner (workspace member) | N/A | ALLOW | ALLOW |
| Shared user | `read` | ALLOW | DENY |
| Shared user | `write` | DENY* | ALLOW |
| Shared user | `read-write` | ALLOW | ALLOW |
| No share | N/A | DENY | DENY |
| Expired share | `read-write` | DENY | DENY |

*Note: check with design — does `write`-only grant browse? The design doc says "Share with `read` or `read-write` permission → allow browse" and "Share with `write` or `read-write` permission → allow produce." This means `write`-only does NOT grant browse. Verify this is implemented correctly.

---

### Concern 5: Cursor Manipulation (Phase A/C) — MEDIUM

**Issue:** The cursor is base64-encoded JSON containing partition offsets. A malicious client could craft a cursor with arbitrary offsets (e.g., negative offsets, offsets beyond the topic's high watermark) or partition IDs that don't exist.

**Mitigation:**
- Test with malformed cursors: invalid base64, valid base64 but invalid JSON, valid JSON with negative offsets, non-existent partition IDs
- Each should return a clear error, not panic or return unexpected data
- Test with a cursor from a different topic — should not cross-read

**Test cases:**
```
cursor = ""                          → fresh fetch (no error)
cursor = "invalid-base64!!!"         → error: invalid cursor
cursor = base64("not-json")          → error: invalid cursor
cursor = base64({"partitions":{"0":-1}}) → error: invalid offset
cursor = base64({"partitions":{"99":0}}) → error or empty (partition doesn't exist)
```

---

### Concern 6: Message Truncation Correctness (Phase A/C) — MEDIUM

**Issue:** Messages exceeding 1MB are truncated server-side with `truncated: true`. If truncation is applied incorrectly (e.g., off-by-one, truncating key when only value is large), the UI could display corrupted data or miss the truncation badge.

**Mitigation:**
- Produce a message with exactly 1MB value → should NOT be truncated
- Produce a message with 1MB + 1 byte value → should be truncated, `truncated: true`
- Produce a message with 10KB + 1 byte key → key should be truncated
- Verify the UI shows the truncation badge when `truncated: true`

---

### Concern 7: Bundle Size Impact from Monaco (Phase C) — MEDIUM

**Issue:** Monaco editor is large (~2MB). The design doc targets zero bundle impact on initial page load via lazy loading. If the dynamic import is misconfigured, Monaco could end up in the initial bundle.

**Mitigation:**
- After Phase C, compare the production build chunk sizes before and after
- Verify Monaco only loads when: (a) a message row is expanded, or (b) the produce sheet opens
- No Monaco code should appear in the initial page load waterfall

**Verification:**
```bash
# Build and check chunk sizes
cd orbit-www && bun run build
# Compare .next/static/chunks/ before and after — no new chunk in initial route
```

---

### Concern 8: Prefix Translation Consistency (Phase A/B) — MEDIUM

**Issue:** Bifrost applies topic prefix translation (virtual name → physical name) in every handler. If one handler prepends the prefix but another doesn't, or if `ListTopics` strips the prefix differently than `DescribeTopic`, the Kafka service will see inconsistent topic names.

**Mitigation:**
- Create a topic via `CreateTopic` with a known name
- Verify it appears in `ListTopics` with the virtual name (prefix stripped)
- Verify `DescribeTopic` returns the same virtual name
- Verify `BrowseMessages` and `ProduceMessage` work with the virtual name
- Verify `DeleteTopic` works with the virtual name
- Run this sequence for at least 2 different virtual clusters with different prefixes

---

## 3. Test Matrix

| Phase | Test Type | Scope | Coverage Target | Runner |
|-------|-----------|-------|-----------------|--------|
| A | Unit tests | Bifrost handler CRUD (8 new RPCs) | Happy path + error per handler | `go test ./internal/admin/...` |
| A | Unit tests | BrowseMessages seek modes | NEWEST, OLDEST, OFFSET | `go test` |
| A | Unit tests | Message truncation logic | Boundary: 1MB exact, 1MB+1, key 10KB+1 | `go test` |
| A | Unit tests | Cursor encode/decode | Valid, malformed, cross-topic | `go test` |
| A | Integration test | Prefix translation consistency | Full CRUD cycle per virtual cluster | Manual or `go test -tags=integration` |
| A | Security test | Consumer cleanup on cancel | 10 requests, 5 cancelled, 0 leaked consumers | Manual + connection count |
| B | Unit tests | Bifrost adapter (11+2 methods) | All methods delegate correctly | `go test ./internal/adapters/bifrost/...` |
| B | Regression tests | Existing Kafka service tests | 0 failures after adapter swap | `go test ./...` |
| B | Regression tests | Topic sharing integration (32 tests) | 32/32 pass | `bun run vitest` |
| B | Integration test | No direct Redpanda connection | 0 matches for franz-go imports in kafka cmd | `grep` check |
| C | Unit tests | Server actions (auth + access) | 6 permission combinations | `bun run vitest` |
| C | Unit tests | TopicMessagesPanel component | Render, filter, pagination, empty state | `bun run vitest` |
| C | Unit tests | ProduceMessageSheet component | Validation, submit, error display | `bun run vitest` |
| C | Unit tests | useTopicMessages hook | State transitions, cursor handling | `bun run vitest` |
| C | Build test | Bundle size check | No Monaco in initial chunk | `bun run build` + chunk analysis |
| C | Build test | tsc clean | Error count <= 120 | `npx tsc --noEmit` |
| D | Integration test | Full browse flow (manual) | Browse owned + shared topics | Browser |
| D | Integration test | Full produce flow (manual) | Produce + verify in refreshed list | Browser |
| D | Regression test | Tech debt metrics | No regression vs. baselines | CI workflow |

---

## 4. Verification Checkpoints Per Phase

### Phase A Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| A.1 | Proto compiles and lints | `cd proto && buf generate && buf lint` | Exit 0, no warnings |
| A.2 | Proto backward compatibility | `buf breaking --against '.git#branch=main'` | No breaking changes to existing RPCs |
| A.3 | Bifrost builds | `cd services/bifrost && go build ./...` | Exit 0 |
| A.4 | Bifrost tests pass | `cd services/bifrost && go test -race ./...` | All pass with race detector |
| A.5 | Temporary consumer cleanup | Cancel mid-browse, check connections | Connections return to baseline |
| A.6 | Prefix translation CRUD cycle | Create → List → Describe → Browse → Produce → Delete | All operations use virtual name correctly |
| A.7 | Cursor edge cases | Malformed/empty/cross-topic cursors | Clear errors, no panics |
| A.8 | Truncation boundaries | Produce 1MB, 1MB+1 messages | Truncation flag correct |

### Phase B Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| B.1 | Kafka service builds | `cd services/kafka && go build ./...` | Exit 0 |
| B.2 | Kafka service unit tests | `cd services/kafka && go test -race ./...` | All pass |
| B.3 | Kafka service integration tests | `cd services/kafka && go test -tags=integration ./...` | All pass |
| B.4 | No direct broker imports | `grep -r "franz-go\|kgo\.\|19092" services/kafka/cmd/` | 0 matches |
| B.5 | Adapter method coverage | `go test -cover ./internal/adapters/bifrost/...` | 90%+ |
| B.6 | Topic sharing regression | `bun run vitest run kafka-topic-catalog.integration.test.ts` | 32/32 pass |
| B.7 | Docker networking | Kafka service → Bifrost admin gRPC | Connection succeeds in docker-compose |

### Phase C Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| C.1 | Frontend builds | `cd orbit-www && bun run build` | Exit 0 |
| C.2 | tsc clean | `cd orbit-www && npx tsc --noEmit 2>&1 \| grep -c "error TS"` | <= 120 |
| C.3 | Frontend tests pass | `cd orbit-www && bun run test:int` | 0 failures |
| C.4 | Permission matrix | 6 test cases per Concern 4 table | All match expected |
| C.5 | Messages tab renders | Navigate to topic detail | 6th tab present |
| C.6 | Browse returns messages | Click Messages tab on topic with data | Table populated |
| C.7 | Produce works | Submit produce form on owned topic | Toast success, message in list |
| C.8 | Access-aware UI | View shared topic (read-only) | No produce button |
| C.9 | Monaco lazy loaded | Check network tab on page load | No Monaco chunks until expand/produce |
| C.10 | Empty state | View topic with no messages | "No messages" state with produce CTA |

### Phase D Checkpoints

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| D.1 | All tests pass | `go test ./...` + `bun run test:int` | 0 failures |
| D.2 | Tech debt metrics | Check CI workflow | No regressions |
| D.3 | Performance: browse | Time 50-message browse | < 2 seconds |
| D.4 | Performance: produce | Time single produce | < 1 second |
| D.5 | No new TODOs introduced | `grep -rE "TODO\|FIXME\|HACK" services/bifrost/ services/kafka/ orbit-www/src/components/features/kafka/ --include="*.go" --include="*.ts" --include="*.tsx" \| wc -l` | Count documented, not above baseline +5 |

---

## 5. Access Control Test Plan (Detailed)

This is the highest-risk area — new permission surfaces for browse and produce.

### Server Action Tests (`kafka-messages.test.ts`)

```
describe('browseTopicMessages')
  it('allows workspace member to browse own topic')
  it('allows user with read share to browse')
  it('allows user with read-write share to browse')
  it('denies user with write-only share from browsing')
  it('denies user with no share from browsing')
  it('denies user with expired share from browsing')
  it('denies unauthenticated user')

describe('produceTopicMessage')
  it('allows workspace member to produce to own topic')
  it('allows user with write share to produce')
  it('allows user with read-write share to produce')
  it('denies user with read-only share from producing')
  it('denies user with no share from producing')
  it('denies user with expired share from producing')
  it('denies unauthenticated user')

describe('getMessagePermissions')
  it('returns canBrowse=true, canProduce=true for owner')
  it('returns canBrowse=true, canProduce=false for read share')
  it('returns canBrowse=false, canProduce=true for write share')
  it('returns canBrowse=true, canProduce=true for read-write share')
  it('returns canBrowse=false, canProduce=false for no share')
```

Total: 21 access control test cases.

---

## 6. Performance Benchmarks

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Browse 50 messages (cold) | < 2s | Time from server action call to response |
| Browse 50 messages (warm) | < 1s | Repeat fetch with cursor |
| Produce single message | < 1s | Time from server action call to response |
| Messages tab initial render | < 500ms | Lighthouse or manual timing |
| Monaco editor mount on expand | < 1s | Time from click to editor visible |
| Initial page load delta | 0 KB | Compare route bundle before/after |

---

## 7. CI Integration

| Phase | Job | Trigger | Timeout |
|-------|-----|---------|---------|
| A | `bifrost-tests` | PR touching `services/bifrost/` or `proto/` | 3 min |
| A | `buf-breaking` | PR touching `proto/` | 1 min |
| B | `kafka-tests` (existing) | PR touching `services/kafka/` | 3 min |
| C | `frontend-build` | PR touching `orbit-www/` | 5 min |
| D | `tech-debt-metrics` (existing) | Every PR | 1 min |

---

## 8. Risk Register (QA-Specific)

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| Consumer leak causes broker connection exhaustion | Low | Critical | Defer cleanup + context timeout + cancel test | QA + Eng |
| Adapter swap breaks existing topic operations | Medium | High | Full regression suite after Phase B | QA |
| Bifrost admin port exposed externally | Low | Critical | Verify docker-compose port mapping | QA |
| Permission bypass allows unauthorized produce | Low | Critical | 21 access control tests + manual verification | QA |
| Cursor manipulation reads cross-topic data | Low | High | Cursor validation tests + topic scoping | QA + Eng |
| Monaco in initial bundle degrades page load | Medium | Medium | Bundle analysis after Phase C | QA |
| Prefix translation inconsistency across handlers | Medium | Medium | Full CRUD cycle test per virtual cluster | QA |

---

## 9. Open Questions for Implementation

1. **Write-only share behavior:** The design doc says `write` permission allows produce but NOT browse. Is this intentional? A user who can produce but can't see what's in the topic seems unusual. Clarify before implementing access control tests.

2. **Consumer timeout:** What's the max duration for a single `BrowseMessages` call before Bifrost kills the temporary consumer? Recommend 30s as a hard timeout.

3. **Rate limiting on produce:** Is there any rate limit on `ProduceMessage`? Without one, a user with write access could flood a topic. Consider a per-user rate limit (e.g., 10 produces/minute) in the Kafka service layer.

4. **Cursor TTL:** Should cursors expire? A stale cursor could reference offsets that have been compacted/deleted. The handler should gracefully handle "offset out of range" errors.
