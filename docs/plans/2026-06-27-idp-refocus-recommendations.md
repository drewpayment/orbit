# Orbit IDP Refocus — Recommendations

**Date:** 2026-06-27
**Status:** Recommendations / proposal — not committed scope
**Branch:** `claude/idp-refactor-service-catalog-g7ch9h`
**Inputs:**
- Current capability inventory (this repo, mid-2026)
- Commercial IDP research: Cortex, Port, Backstage (see §8 for sources)
- Prior strategy: `docs/plans/2026-06-09-product-focus-strategy.md`, issue [#45](https://github.com/drewpayment/orbit/issues/45)

---

## 0. TL;DR

Orbit feels sprawled because it grew a layer of **platform machinery** (Kafka proxy,
infra agent, cloud launches, container registry, health monitoring, deployment
generators, build service) faster than it grew the **IDP spine** (catalog → golden
paths → scorecards → automation). Each piece justified itself individually; together
they read as "a bit of everything." Meanwhile the heart of what you're now asking for —
**operational excellence reviews / scorecards — does not exist at all.**

The fix is not "delete the platform work." It's a **mental-model reframe**: a focused
IDP has exactly **four product pillars**, and every existing Orbit feature should be
re-cast as one of them or stripped:

1. **Software Catalog** — the entity graph (services, APIs, resources, Kafka topics, teams, domains)
2. **Operational Excellence** — scorecards, maturity ladders, initiatives *(the big gap)*
3. **Golden Paths / Self-Service** — templates + actions, executed durably
4. **Automation** — event-driven evaluation, drift detection, remediation

The reframe **reconciles** this request with the 2026-06-09 strategy: **Bifrost and the
infra agent stop being separate "platform products" and become Orbit's differentiated
self-service (Pillar 3) and automation/execution (Pillar 4) layer.** That's exactly how
Port frames its business — the self-service action engine *is* the product, and Orbit
happens to have a world-class Kafka action and an AI execution backend nobody else has.

The single highest-leverage build is **Pillar 2 (scorecards)** — it's issue #45, it's
what "operational excellence reviews" means, and Orbit has all the substrate (Temporal,
54 collections, approval plumbing) and none of the feature.

---

## 1. How the leaders are structured (and what to copy)

| | **Backstage** | **Cortex** | **Port** |
|---|---|---|---|
| Identity | Open-source *framework* | "Engineering Operations Platform" (standards-led) | Fully-customizable IDP → "agentic SDLC" |
| Catalog | Fixed kinds (Component/API/Resource/System/Domain) | Broad, semi-rigid entity types | Generic **blueprint/entity/relation graph** |
| Scorecards | None (3rd-party plugin) | **Flagship**: rules + levels + **Initiatives** | Scorecards-as-data (Scorecard/Rule/**RuleResult** entities) + automations |
| Golden paths | Software Templates (Scaffolder) | Cookiecutter + Workflows | **Self-Service Actions + Action Runs**, pluggable CI/CD backends |
| Automation | None native | Scheduled eval + human Initiatives | **Event-driven** orchestrator (drift detection) |
| Homepage | DIY plugin | Eng Homepage (my PRs + action items) | Personalized + per-persona dashboards |

**The four patterns worth stealing for Orbit:**

1. **Port's catalog graph** — blueprints (schema) + entities (instances) + typed
   **relations** + mirror/calculation/aggregation properties. More future-proof than
   fixed kinds. This is the architectural keystone.
2. **Port 2.0's "scorecards as data"** — `Scorecard` / `Rule` / `RuleResult` as
   first-class catalog entities so results are queryable, dashboard-able, and
   automation-triggering.
3. **Cortex's Initiatives** — the *human* improvement loop (owner + deadline + action
   items) that Port notably lacks. Combine both: Port's data model + Cortex's campaign UX.
4. **Port's Action + Action Run** — durable execution record with status/logs/lifecycle.
   This **maps one-to-one onto Temporal**, which Orbit already runs. It's a genuine
   structural advantage, not a thing to build from scratch.

**Scope-discipline lesson:** Cortex wins by being *narrow, opinionated, standards-first*.
Port's current risk is sprawling into an "agentic everything" hub. For a *refocus*,
Cortex's discipline is the cleaner template — pick catalog + scorecards + golden paths +
initiatives and resist re-sprawling.

---

## 2. The four pillars vs. what Orbit has today

### Pillar 1 — Software Catalog *(have it, but fragmented)*

**Today:** the catalog is split across siloed collections and pages, each with its own
data model and nav item: `Apps`, `APISchemas`, `Templates`/`Patterns`, the Kafka
entity family (`KafkaTopics`, `KafkaSchemas`, …), `KnowledgeSpaces`. There is **no
unified "entity" concept and no relation graph** — you can't ask "what APIs does this
service expose, what Kafka topics does it produce, what pattern was it built from, who
owns it, what environments does it run in" as one query.

**Recommendation:** introduce a **generic catalog model** (Port-style) as the spine:
- `CatalogEntity` (typed: Service, API, Resource, Datastore, KafkaTopic, Domain, Team, Environment, System) + `CatalogRelation` (typed edges).
- Migrate `Apps`/`APISchemas`/Kafka entities to *be* entity types (or project into the graph) rather than parallel silos.
- **Exploit what you uniquely have:** Orbit's **Kafka lineage** (`KafkaLineageEdge`,
  producer/consumer byte flows) is real relation data most IDPs can't get. Surface it as
  catalog relations — "Service A produces topic T consumed by Service B" — and it becomes
  a differentiator, not a Kafka-tab detail.
- Ownership should survive personnel change (Cortex pattern): key ownership to Team
  entities + IdP groups, not individual users.

This is the #1 structural refactor; pillars 2–4 all hang off it.

### Pillar 2 — Operational Excellence / Scorecards *(does not exist — the gap)*

**Today:** zero. The closest things are the frozen `HealthChecks` badge and the
`PendingApprovals` plumbing. This is precisely "operational excellence reviews."

**Recommendation:** build it as issue #45 describes, using the **Port-data-model +
Cortex-campaign hybrid**:
- `Scorecard` / `Rule` / `RuleResult` as catalog entities (queryable + automation-able).
- Three v1 rule types (per #45): field-presence (owner/docs/on-call set), relation checks
  (uses an approved pattern version, schema registered), threshold checks (health green,
  cost tags present).
- **Maturity ladders** (Basic→Bronze→Silver→Gold) for production-readiness / operational-maturity reviews.
- **Initiatives** — the Cortex piece Port lacks: time-boxed campaign with owner, deadline,
  per-entity **action items**. This is what turns a scorecard into an actual "review."
- Evaluation via a **new Temporal workflow** (nightly + on-change). Plumbing exists;
  this is a new workflow type, not new infra.
- **AI governance rides the same engine** (#45): "uses approved AI framework" / "agent
  actions have approval records" are just rules over data Orbit already stores (agent HITL
  records, pattern lineage). No separate subsystem.
- **One org-level rollup page** = the exec-visibility deliverable. Same feature.

Fold the frozen **health badge into a scorecard threshold rule** rather than keeping
"health monitoring" as its own concept — it removes a frozen capability *and* feeds the
new pillar.

### Pillar 3 — Golden Paths / Self-Service *(have the pieces, no unifying model)*

**Today:** `Templates` (repo scaffolding), `Patterns`/`PatternInstances` (golden paths),
the **infra agent** (AI-driven provisioning with HITL), **Bifrost** (Kafka self-service),
**Launches** (Azure/DO), deployment generators, build service. Five+ separate surfaces
that are all, conceptually, "a developer requests something and a durable workflow
fulfills it."

**Recommendation:** unify under a single **Self-Service Action + Action Run** model:
- An `Action` = input form + approval policy + a **backend** (Temporal workflow,
  GitHub workflow, the infra agent, Bifrost provisioning, a launch, a deployment generator).
- An `ActionRun` = durable execution record (status, logs, lifecycle) — **this is just a
  Temporal workflow execution surfaced as a first-class object.** Orbit's Temporal
  investment makes this nearly free and is a real edge over Backstage/Cortex.
- **Reframe the platform bets as flagship actions, not products:**
  - Bifrost Kafka provisioning → the marquee self-service action ("provision a governed Kafka topic with schema + quota").
  - Infra agent → the **AI-assisted execution backend** for actions, with HITL approval (this *is* the "AI governance" story from the 2026-06-09 doc).
  - Launches (Azure/DO) → a golden-path action, not a standalone "Launches" nav area.
  - Deployment generators / build service → action backends, not standalone surfaces.

This is the reconciliation: nothing valuable gets deleted, but the product stops looking
like five products.

### Pillar 4 — Automation *(have the engine, lack the abstraction)*

**Today:** Temporal workflows scattered per-feature; `PendingApprovals` for human gates.
No general "when X changes, do Y" primitive.

**Recommendation:** formalize an **event-driven automation** primitive that listens to
catalog/scorecard changes (especially **RuleResult** changes) and runs an Action. That
gives you **drift detection** ("service fell out of compliance → notify owner / open
remediation action") and optional auto-remediation. Same backend as Pillar 3; only the
trigger differs (event vs. user) — exactly Port's "two primitives, one execution engine."

---

## 3. What to strip, freeze, or fold (extends the 2026-06-09 strip list)

Already decided & correct (keep executing): delete AWS/GCP workers, plugins service,
Backstage backend; freeze container registry. No change.

**Additional refocus moves:**

| Capability | Recommendation | Why |
|---|---|---|
| Health monitoring | **Fold** the badge into a scorecard threshold rule; retire the standalone concept | Removes a frozen feature, feeds Pillar 2. SLO/alerting stays Grafana/Datadog's job. |
| Launches (Azure/DO) | **Demote** from top-level product to a golden-path Action | It's self-service, not a separate product surface. |
| Deployment generators + build service | **Reframe** as Action backends; pause standalone investment | Platform machinery, not a user-facing pillar. |
| Container registry | Keep **frozen**; schedule eventual delete | Commodity (ACR/GHCR). |
| Knowledge (spaces/pages) | **Decide explicitly** — fold into catalog as entity-linked docs, or de-emphasize | Cortex deliberately ships *no* TechDocs. A full wiki is classic IDP sprawl. See §6. |
| Billing/chargeback | Keep as **catalog cost metadata** feeding a scorecard rule (#45 Proposal 2), not a billing product | Orbit is not a FinOps platform. |

**Navigation is where sprawl is most visible.** Today there are ~30 routes (`/apps`,
`/catalog/apis`, `/templates`, `/knowledge`, `/platform/kafka`, `/platform/approvals`,
`/platform/workflows`, `/launches`, `/agent`, `/billing`, …). Collapse to **five surfaces**
matching the pillars:

1. **Home** — personalized: my services, my action items, my scorecard gaps (table-stakes per §1).
2. **Catalog** — the unified graph; *apps / APIs / Kafka topics / resources become entity-type filters, not separate nav items.*
3. **Scorecards & Initiatives** — operational excellence reviews + exec rollup.
4. **Self-Service** — the Actions catalog + Action Runs (Bifrost, patterns, launches live here).
5. **Automations** — admin surface for event rules.

(Plus Settings/Admin.) This single change makes the product *feel* focused even before
the data-model work lands.

---

## 4. The one decision that's genuinely yours

The 2026-06-09 doc's open question (§7) was: **is Orbit an evaluation baseline that keeps
vendors honest, or a platform layer kept alongside a purchased Cortex/Port?** This request
implies a third answer: **Orbit is the IDP** — and Bifrost + agent are its differentiated
self-service/automation layer rather than standalone platform products.

These lead to materially different investment levels in the catalog UI and scorecards:

- **If "Orbit is the IDP"** → invest fully in pillars 1–4; the catalog UI deserves real polish; scorecards become top priority. *(This is what your request implies and what I recommend.)*
- **If "platform alongside a purchased portal"** → keep the catalog thin, skip scorecards (the bought portal wins there), and Bifrost + agent stay the only real investments.

I recommend the first, *because* the reframe means you don't lose the platform bets — you
absorb them. But this is a business call (who's the buyer, are vendor demos still
happening?) and should be confirmed with the sponsor before committing build scope.

---

## 5. Suggested sequence (if the IDP refocus is chosen)

Respects the 2026-06-09 security sequencing (strip + gRPC auth interceptor land first).

1. **Navigation/IA refactor** (cheap, high signal) — collapse to the five surfaces; make apps/APIs/Kafka entity-type filters of one Catalog. Mostly frontend; no data migration. *Makes the product feel focused immediately.*
2. **Unified catalog model** (Pillar 1) — `CatalogEntity` + `CatalogRelation`; project existing collections in; surface Kafka lineage as relations.
3. **Scorecards v1** (Pillar 2 / issue #45) — Scorecard/Rule/RuleResult + ladders + one rollup; nightly+on-change Temporal eval; fold health badge into a rule.
4. **Action/ActionRun model** (Pillar 3) — wrap Temporal executions; reframe Bifrost/patterns/launches/agent as actions/backends.
5. **Initiatives + event automation** (Pillars 2+4) — campaigns with action items; drift detection on RuleResult changes.
6. **Cost visibility** (#45 Proposal 2) — catalog cost metadata + a scorecard rule; wire in existing Kafka chargeback collections.

Steps 1 and 3 are independently valuable and can ship before the full graph migration.

---

## 6. Open questions for the sponsor

1. **Orbit's identity** (§4): the IDP, or a platform layer beside a purchased portal? Determines catalog-UI and scorecard investment.
2. **Knowledge module**: fold into catalog as entity-linked docs, keep as a deliberate differentiator, or de-emphasize? (Cortex ships none.)
3. **Force-ranked criteria** (from #45): does standards enforcement actually top the list? If yes, Pillar 2 is priority #1.
4. **Exec visibility**: is one rollup page enough, or is export/reporting required (materially larger scope)?

---

## 7. Why this is the right shape

- It **answers the request** — catalog, automation, golden paths, operational excellence become the *only* four things Orbit is about.
- It **doesn't waste the platform investment** — Bifrost and the agent become the strongest differentiators *within* the IDP frame instead of competing products.
- It **closes the real gap** — scorecards/operational excellence, which today is zero.
- It **leans on Orbit's structural edge** — Temporal makes durable Action Runs and scorecard evaluation cheap; Kafka lineage gives a catalog graph competitors can't easily match.
- It **stays disciplined** — Cortex's "narrow + standards-first," not Port's "agentic everything."

---

## 8. Sources

Cortex: [IDP definition](https://www.cortex.io/post/what-is-an-internal-developer-portal),
[Scorecards](https://docs.cortex.io/standardize/scorecards),
[Scorecards-as-code](https://docs.cortex.io/standardize/scorecards/scorecards-as-code),
[Initiatives](https://docs.cortex.io/improve/initiatives),
[Scaffolder/Workflows](https://docs.cortex.io/streamline/workflows/scaffolder),
[Homepage](https://docs.cortex.io/homepage).
Port: [Data model](https://docs.port.io/build-your-software-catalog/customize-integrations/configure-data-model/),
[Scorecards](https://docs.port.io/scorecards/concepts-and-structure/),
[Scorecards 2.0](https://www.port.io/blog/scorecards-2),
[Actions & automations](https://docs.port.io/actions-and-automations/),
[$100M / agentic repositioning](https://siliconangle.com/2025/12/11/port-nets-100m-turn-developer-portal-agentic-ai-hub/).
Backstage: [System model](https://backstage.io/docs/features/software-catalog/system-model),
[backstage.io](https://backstage.io/).
Comparisons: [OpsLevel: Port vs Cortex](https://www.opslevel.com/resources/port-vs-cortex-whats-the-best-internal-developer-portal),
[Port: Backstage alternatives](https://www.port.io/blog/top-backstage-alternatives).
