# Code Context

## Files Retrieved

1. `orbit-www/src/collections/scorecards/Scorecards.ts` (lines 21-46) — scorecards currently permit direct create/update/delete through Payload access rules.
2. `orbit-www/src/collections/scorecards/ScorecardRules.ts` (lines 48-66) — rule mutations are likewise directly exposed; `beforeValidate` centralizes relationship validation.
3. `orbit-www/src/collections/scorecards/invariants.ts` (lines 20-70) — established hook helper using `req.payload`, `originalDoc`, and `overrideAccess`.
4. `orbit-www/src/collections/scorecards/ScorecardRuleResults.ts` (lines 14-47, 85) — machine-owned collection blocks direct mutations, while trusted services use `overrideAccess`; defines a compound unique index.
5. `orbit-www/src/collections/scorecards/EntityScores.ts` (lines 1-109, particularly access near 35-40 and index at 103) — same machine-owned collection pattern and compound uniqueness.
6. `orbit-www/src/collections/scorecards/ScoreSnapshots.ts` (lines 5-42) — append-only, service-owned scorecard records with all direct mutations disabled.
7. `orbit-www/src/lib/scorecards/evaluate.ts` (lines 495-625) — centralized upsert/reconciliation service with find/update/create race recovery and duplicate cleanup.
8. `orbit-www/src/collections/Workspaces.ts` (lines 268-345) — nested hook writes use a `context.skipHierarchySync` recursion guard and `overrideAccess`.
9. `orbit-www/src/collections/KnowledgePages.ts` (lines 421-553) — another bidirectional synchronization hook using context guards for nested updates.
10. `orbit-www/src/app/(frontend)/scorecards/actions.ts` (lines 602-706, identified entry points) — current scorecard create/update/delete server actions.
11. `orbit-www/src/app/(frontend)/scorecards/actions.test.ts` (lines 18-66) — existing update/delete action tests.
12. `orbit-www/src/payload.config.ts` (lines 1-180) — Mongo adapter and collection registration; no migration/startup deduplication hook was found.
13. `orbit-www/src/scripts/backfill-catalog-graph.ts` (lines 1-128) — precedent for an explicit one-shot Payload backfill script.
14. `orbit-www/package.json` (lines 7-25) — scripts are explicit `tsx src/scripts/...` commands; no Payload migration command or automatic startup migration is configured.

## Key Code

### Direct authoring remains enabled

`orbit-www/src/collections/scorecards/Scorecards.ts:31-36`:

```ts
access: {
  read: workspaceScopedRead,
  create: workspaceScopedManageCreate,
  update: workspaceScopedMutate('scorecards', ['owner', 'admin']),
  delete: workspaceScopedMutate('scorecards', ['owner', 'admin']),
},
```

Consequently REST, GraphQL, and admin mutations can bypass side effects implemented only in server actions.

### Existing service-owned collection pattern

`orbit-www/src/collections/scorecards/ScorecardRuleResults.ts:20-27`:

```ts
access: {
  read: workspaceScopedRead,
  create: () => false,
  update: () => false,
  delete: () => false,
},
```

`EntityScores`, `ScoreSnapshots`, and `InitiativeActionItems` use the same pattern. Internal code writes with `overrideAccess: true`.

### Existing hook validation pattern

`orbit-www/src/collections/scorecards/ScorecardRules.ts:59` registers:

```ts
hooks: { beforeValidate: [validateRuleRelationships] },
```

`orbit-www/src/collections/scorecards/invariants.ts:31-36` performs nested reads through the current request’s Payload instance:

```ts
const scorecard = await req.payload.findByID({
  collection: 'scorecards',
  id: scorecardId,
  depth: 0,
  overrideAccess: true,
})
```

This centralizes invariants across admin, REST, and local API mutation paths.

### Existing recursion-guard pattern

`orbit-www/src/collections/Workspaces.ts:333-343`:

```ts
await payload.update({
  collection: 'workspaces',
  id: previousParent,
  data: { childWorkspaces: updatedChildren },
  context: { skipHierarchySync: true },
  overrideAccess: true,
})
```

The enclosing hook checks `context?.skipHierarchySync` before synchronizing. `KnowledgePages.ts:421-553` follows the same structure.

### Existing idempotent upsert and deduplication behavior

`orbit-www/src/lib/scorecards/evaluate.ts:515-560`:

- Finds by the logical compound key.
- Updates an existing row.
- Otherwise creates.
- If creation loses a unique-index race, re-finds and updates the winner.

`evaluate.ts:570-608` additionally scans result rows, retains one row per logical rule/entity pair, and deletes stale or repeated IDs.

Compound uniqueness already exists at:

- `ScorecardRuleResults.ts:85`: `['scorecard', 'rule', 'entity']`
- `EntityScores.ts:103`: `['entity', 'scope', 'scorecard']`
- `InitiativeActionItems.ts:73`: `['initiative', 'entity', 'rule']`

## Architecture

Current scorecard authoring flows are split:

1. Server actions at `src/app/(frontend)/scorecards/actions.ts` perform user-facing mutations and side effects.
2. Collections independently permit owner/admin mutations.
3. Collection hooks enforce relationship invariants, but scorecard update/delete side effects are not structurally guaranteed when REST/admin writes bypass the server actions.
4. Generated scorecard data already uses a stronger model: public mutation access is denied and centralized services write with `overrideAccess`.

Request propagation is only partially established. Hooks correctly receive `req` and use `req.payload`, while nested synchronization examples propagate `context` but generally do not pass the full `req` into local operations. For Payload transaction/session and request context continuity, new nested operations should include both:

```ts
req,
context: { ...req.context, skipScorecardSideEffects: true },
overrideAccess: true,
```

Avoid replacing context outright when callers may already carry transaction or recursion metadata.

No repository-managed Payload/Mongo migration framework or automatic startup deduplication was found. The established operational precedent is a manually invoked, idempotent `src/scripts/*.ts` backfill. Running destructive deduplication in `onInit` would be unsafe under multi-instance startup.

## Smallest Production-Safe Approach

1. Extract scorecard update/delete behavior from `scorecards/actions.ts` into a small `lib/scorecards/service.ts` accepting a `PayloadRequest` rather than only a global `Payload`.
2. Have server actions authenticate/authorize, then call that service.
3. Set scorecard and, if covered by the same authoring contract, rule `update`/`delete` access to `() => false`; trusted service operations use `overrideAccess: true`.
   - This is the repo’s established machine-owned mutation pattern.
   - Keep create exposed only if direct creation has no required side effects; otherwise centralize create too.
4. Pass `req` and a namespaced recursion context through every nested Payload operation.
5. Retain collection hooks for invariants and as defense-in-depth, but do not duplicate complex side-effect orchestration between hooks and actions.
6. Before adding or changing unique indexes, ship an explicit idempotent one-shot script:
   - group by the intended logical key;
   - select a deterministic survivor, preferably newest `updatedAt`/`evaluatedAt`, then stable ID;
   - repair references if applicable;
   - delete losers;
   - rerun and assert zero duplicate groups;
   - only then deploy the unique index.
7. Do not run deduplication from Payload startup: concurrent replicas could race, prolong boot, or partially mutate production data.

### Required tests

- REST/admin-style local update/delete cannot bypass the service.
- Authorized service update/delete performs each side effect once.
- Nested writes receive the originating `req`.
- recursion context prevents re-entry without suppressing unrelated hooks.
- deduplication script is idempotent and deterministically selects a survivor.
- unique-index race fallback still updates the winning record.

## Start Here

Open `orbit-www/src/app/(frontend)/scorecards/actions.ts` at lines 602-706 first. It contains the existing authoring orchestration that should be extracted rather than reimplemented. Then align its boundary with the service-owned access pattern in `ScorecardRuleResults.ts:20-27`.

## Review Findings

- **High:** `Scorecards.ts:31-36` and `ScorecardRules.ts:50-55` permit direct Payload mutations, so action-only side effects can be bypassed.
- **Medium:** Existing nested hook examples propagate recursion context but not consistently the originating `req`; copying them literally risks losing transaction/request context.
- **Medium:** Compound unique indexes exist, but no production migration/startup deduplication mechanism was found. Existing duplicate data must be cleaned before introducing a new unique constraint.
- **No blocker** to the recommended service extraction and access lockdown, provided admin editing is intentionally replaced by the authorized application flow.