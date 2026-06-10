# Orbit Product Focus Strategy — Strip Back & Sharpen

**Date:** 2026-06-09
**Status:** Keep/strip decisions **accepted**. Build candidates (scorecards, cost visibility) are **not committed** — tracked as a proposal in [#45](https://github.com/drewpayment/orbit/issues/45), pending the force-ranking exercise with the sponsor.
**Inputs:** Commercial IDP evaluation (Cortex / Port / OpsLevel / DX), security & engineering audit (`docs/audits/2026-06-09-security-and-engineering-audit.md`), capability inventory (this doc, §2)

## 1. Decision frame

Three principles drive every keep/strip call below:

1. **Invest in what survives a vendor purchase.** If the org buys Cortex or Port, Orbit's
   generic catalog becomes redundant overnight — but Bifrost (Kafka self-service proxy)
   and the infra agent do not. No commercial portal proxies Kafka with multi-tenant
   virtual clusters, and none executes governed infrastructure changes through an agent
   with HITL approval gates. Those are *platform* capabilities, not portal features.
   Differentiated platform > commodity portal.

2. **Score against the force-ranked criteria, not the wish list.** The evaluation
   reframed the six requirements: FinOps becomes "cost visibility per service/team in
   the catalog" (achievable), productivity measurement is conceded to DX/Cortex (don't
   build), and the likely top-ranked trio is **standards enforcement + AI governance +
   exec visibility**. Orbit currently has *zero* scorecard/standards capability — the
   single biggest gap between what Orbit is and what the evaluation says matters.

3. **Strip by deletion retires audit criticals for free.** The two worst audit findings
   (command injection in the GCP deploy worker; Pulumi state/destroy-path exposure) live
   entirely in capabilities that the strategy says to cut anyway. Deleting code is the
   cheapest remediation there is.

One framing note: the org is an **Azure shop**. Orbit currently maintains three cloud
provisioning workers (AWS, GCP, Azure). Two of them serve no one.

## 2. Capability disposition

| Capability | Maturity today | Disposition | Rationale |
|---|---|---|---|
| Software catalog (repos/APIs/docs) | Production, ~24K LOC | **Keep — maintain** | Table stakes; the spine everything else hangs on. No new investment beyond scorecard hooks. |
| Bifrost / Kafka self-service | Production, ~38K LOC, flagship | **Keep — flagship** | Genuinely differentiated; survives any vendor purchase. Finish Phase 6 metrics (feeds cost visibility, §4.2). |
| Infra agent | Alpha→Beta, very active | **Keep — reposition as AI governance** | The 2026 evaluation criterion is AI governance: approved frameworks, audited agent actions, HITL gates. Orbit's agent already has the approval/audit plumbing — reframe and harden rather than add features. |
| Patterns catalog + templates | Alpha, newly shipped | **Keep — polish only** | This *is* "self-service with golden paths." Finish import polish; no expansion. |
| Workspaces / multi-tenancy / approvals | Production | **Keep** | Foundation; hardening covered by audit Phase 0/1. |
| **Scorecards / standards enforcement** | **Does not exist** | **Proposed — see [#45](https://github.com/drewpayment/orbit/issues/45)** | Top-ranked evaluation criterion; not committed. Go/no-go after sponsor force-ranking. |
| **Cost visibility per service/team** | Data structures only (Kafka chargeback collections, no UI) | **Proposed — see [#45](https://github.com/drewpayment/orbit/issues/45)** | The FinOps reframe; not committed. Depends on scorecards if approved. |
| Launches / cloud provisioning | Prototype, 3 workers, 13 in-flight plans | **Strip to Azure-only; quarantine AWS/GCP** | Azure shop. AWS/GCP workers are unmaintained attack surface holding cloud credentials — the audit's worst findings live here. See §3.1. |
| Deployment generators (Terraform/Helm/Compose) | Alpha | **Pause** | Useful but downstream of launches; resume only for the Azure path. |
| Container registry | Stub (~150 LOC) | **Strip — freeze** | Commodity (ACR/GHCR). Token endpoint stays only if anything depends on it; no UI investment. |
| Plugins service | Stub, 15 TODOs, no auth interceptors | **Strip — fold or delete** | Highest TODO density, unauthenticated gRPC surface. Fold the tool-registry concept into the agent's existing tool registry; delete the standalone service. |
| Health monitoring | Prototype | **Strip to a badge** | SLO/alerting is Grafana/Datadog's job. Keep the catalog health badge; delete ambitions beyond it. |
| Backstage backend | Orphaned, 0 tests, single-tenant blocker | **Delete** | Abandoned in practice; make it official. |
| Productivity measurement | Nothing | **Explicit non-goal** | The evaluation concedes this to DX/Cortex. Do not build engineering metrics into Orbit. |

## 3. Strip list — concrete actions

### 3.1 Launches workers (highest value strip)
- Remove `launches-worker-aws` and `launches-worker-gcp` from the repo, compose files,
  K8s manifests, and CI. Tag the last commit containing them for archaeology.
- This **deletes audit Critical #1** (command injection in `launches-worker-gcp/src/activities/deploy-static-site.ts`).
- For the retained Azure worker: fix Pulumi passphrase handling (audit Critical #3),
  tenant-scope `destroyInfra` stack names, stop copying Pulumi secret outputs into
  Temporal-persisted return values, and parameterize any exec calls.
- Close/archive the non-Azure launches plans in `docs/plans/`.

### 3.2 Plugins service
- Migrate anything the agent actually uses from `services/plugins` into the agent's
  tool registry in `temporal-workflows`; delete the service, its proto surface, and
  its unauthenticated gRPC listener.

### 3.3 Backstage backend
- Delete `services/backstage-backend`, its compose/K8s entries, and seed data.

### 3.4 Container registry & health monitoring
- Mark both "frozen" in README/docs. No deletions required; no new work accepted.

**Net effect:** two fewer credential-holding workers, two fewer unauthenticated gRPC
services, ~15 fewer in-flight plan documents, and the audit's #1 critical gone by `git rm`.

## 4. Build candidates — deferred to issue #45

Scorecards (standards enforcement + exec rollup + AI-governance rules) and narrow cost
visibility are **proposals, not committed work**. Full scope, rationale, dependencies,
and open questions are tracked in
[#45 — Proposal: Scorecards + cost visibility](https://github.com/drewpayment/orbit/issues/45).
Decision point: after the force-ranking exercise with the sponsor. If a commercial
portal is purchased, the scorecard proposal likely dies with it; cost visibility may
survive as Bifrost chargeback UI only.

## 5. Security sequencing (revised audit Phase 0)

Stripping changes the audit math. Remaining Phase 0, in order:

1. Strip per §3 (deletes Critical #1, shrinks gRPC attack surface).
2. Fail-fast on missing secrets — remove all fail-open defaults (`orbit-internal-dev-key`,
   `dev-secret-key`, `orbit-registry-token`, `orbit-secret-key`, `orbit-dev-passphrase`); rotate.
3. IDOR fixes in launch/deployment server actions (copy the `createLaunch` membership-check
   pattern); authenticate `/api/workspaces` and `/api/seed-generators`; resolve the Kafka
   admin-role TODOs.
4. Azure worker hardening per §3.1.
5. Phase 1 unchanged: shared gRPC auth interceptor (verified identity + workspace claims)
   for the **kept** services only — Kafka and repository. This also fixes the
   `betterAuthId` vs `user.id` membership-lookup inconsistency (add the regression test).

## 6. Sequence (accepted scope)

| Order | Work | Why this order |
|---|---|---|
| 1 | Strip (§3) + fail-open secrets + IDOR fixes | A week of deletions and mechanical fixes; halves the audit surface before any new feature work. |
| 2 | gRPC auth interceptor (Kafka, repository) | Highest-leverage architectural fix; everything new builds on a real trust boundary. |
| 3 | Azure launches hardening + patterns-catalog polish | Completes the kept surface. |
| — | Build candidates ([#45](https://github.com/drewpayment/orbit/issues/45)) | Slot in here only if approved after force-ranking. |

## 7. Open decision

**Orbit's role must be named before the vendor demos:** evaluation baseline that keeps
vendors honest, or the platform layer retained *alongside* a purchased portal. This plan
is compatible with both — the keep list (Bifrost, agent, patterns) is exactly the subset
that remains valuable next to Cortex or Port — but the answer determines how much polish
the catalog UI deserves and who the economic buyer is. Decide with the sponsor during
the force-ranking exercise.
