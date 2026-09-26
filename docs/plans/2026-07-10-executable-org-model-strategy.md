# Orbit as an Executable Model of the Software Organization — Strategy Memo

**Date:** 2026-07-10
**Status:** Exploration / decision memo. No commitments implied. Builds on the accepted
keep/strip decisions in `docs/plans/2026-06-09-product-focus-strategy.md`.
**Question under examination:** Should Orbit evolve from a catalog-plus-governance IDP
into a continuously updated, *executable* model of the software organization — a system
that can explain how the org's software works, predict the consequences of change, and
carry out bounded changes under governance?

---

## 1. Executive conclusion

**The thesis is directionally right but mis-framed, and Orbit is closer to the
defensible half of it than the framing suggests.**

"Executable model" bundles three products that have very different maturity, risk, and
value profiles:

1. **An evidence-backed organizational graph** (answers questions with citations) —
   buildable now, valuable, weakly defensible on its own.
2. **A change simulator** (predicts consequences before you act) — partially buildable;
   the word "simulate" overpromises. What is actually achievable is *static blast-radius
   computation plus historically calibrated estimation*, and the honest product word for
   that is **change planning**, not simulation.
3. **A governed execution engine** (carries out bounded changes with approvals, audit,
   and rollback) — **this is the part Orbit has already partially built**, and it is the
   part that generates the proprietary prediction-vs-outcome data that makes (1) and (2)
   compound over time. It is *not* empty territory — OpsLevel's Tidra, Sourcegraph's
   Agentic Batch Changes, Moderne's Moddy, and Port's agentic pivot all attack governed
   mass change (§16) — but none of them grades its predictions, and none closes the loop
   from continuous drift detection to execution inside one governance envelope. The
   genuine whitespace, confirmed by a dedicated landscape sweep, is **what-if change
   simulation over an org-wide graph and calibrated prediction** — which is reachable
   only through the execution ledger.

The June 2026 product-focus exercise already reached the embryonic form of this
conclusion without naming it: the keep list (Bifrost, the HITL-gated infra agent,
scorecards, automations, Temporal) is exactly the *actuation and sensing layer* of an
executable model, and the strip list (generic catalog polish, health dashboards,
multi-cloud provisioning) is exactly the *descriptive* surface that commercial portals
commoditize. The strategic move is not "add AI to the catalog." It is: **invert the
architecture so the catalog serves the change engine, instead of the agent serving the
catalog.**

**Recommended wedge:** *Governed remediation* — close the loop from scorecard-detected
drift → agent-drafted fix → human-approved, policy-checked execution → verified outcome →
recorded prediction-vs-actual. Ship it on the narrow classes of change Orbit can verify
end-to-end today (dependency/runtime upgrades, config and manifest standardization,
Kafka client/schema migrations via Bifrost). Change-impact analysis ("what breaks if…")
is the second layer, built on the evidence the wedge accumulates — not the first, because
impact analysis without execution is a report, and reports do not compound.

**The single biggest risk** is not technical. It is that this is a
trust-and-data-gravity business being attempted from a position of near-zero deployed
footprint, while GitHub, Cortex, Port, and every coding-agent vendor converge on
adjacent territory with vastly more distribution. The mitigations are (a) pick change
classes where verification is mechanical so trust is earned per-PR rather than granted
up front, and (b) exploit the one data source Orbit uniquely owns — Bifrost sits in the
Kafka data path and observes *actual* producer/consumer behavior, which is ground-truth
dependency evidence no portal that reads metadata can fake.

---

## 2. Precise definition of the opportunity

### 2.1 What "an executable model of a software organization" means

A system holding a **versioned, evidence-backed representation** of an organization's
software estate — components, interfaces, dependencies, ownership, policies, deployment
and incident history — with three properties that make it *executable* rather than
descriptive:

1. **Closed-world queries over an open-world estate.** It can answer "what depends on
   X?" with a *bounded confidence claim*: "here are the 14 known consumers, here is the
   evidence for each, and here is the residual risk that unobserved consumers exist,
   estimated from how X is exposed." A catalog answers with whatever was registered.

2. **Predictions that are scored.** Every claim about the future ("retiring this API
   breaks these 3 services," "this migration is ~40 PRs and 2 weeks") is recorded, and
   when the change actually happens, the prediction is graded against reality. The
   system's error bars are empirical, not vibes.

3. **A path from answer to action inside the same governance envelope.** The output of
   a query can be promoted to a plan, the plan to a set of executed changes, with
   authorization levels, policy checks, audit, and rollback as first-class structure —
   not a copy-paste into Jira.

Property 3 is what "executable" should mean. Properties 1–2 are what make executing
safe. A system with all three is not a better catalog; it is a different kind of thing —
the organization's **change control plane**.

### 2.2 What it is not — boundary by boundary

| Adjacent thing | Where the boundary is |
|---|---|
| **Developer portal** | A portal presents registered information to humans. It has no notion of prediction, confidence, or actuation. Portals answer "what exists?"; this answers "what happens if?" and "make it so, safely." |
| **Service catalog** | A catalog is a *declared* inventory; correctness depends on humans registering things. The model treats declarations as one evidence stream among many (code, traffic, deploy history) and models their disagreement. |
| **Knowledge graph** | A knowledge graph is the substrate, not the product. A graph with no actuation and no prediction scoring is a very expensive diagram. The graph is necessary; it is nowhere near sufficient. |
| **Enterprise search / RAG** | Search retrieves what was written. Most of the high-value questions (§4) have answers that were *never written anywhere* — they must be computed from structure or inferred from behavior. RAG over docs inherits the docs' staleness. |
| **Software digital twin** | Closest cousin. The difference is honesty about fidelity: a physics twin simulates forward from state equations; a software org has no state equations. This system does static analysis where structure permits, statistical estimation where history permits, and says "unknown" elsewhere. Calling it a twin invites the overpromise this memo tries to kill. |
| **Observability platform** | Observability answers "what is happening / happened?" at the telemetry layer with no model of intent, ownership, or policy. It is an *input*. (Bifrost is, in effect, Orbit's first built-in observability source.) |
| **Workflow engine** | Temporal executes steps durably; it has no opinion about *which* steps or *whether they're safe*. The engine is the muscle; the model is the nervous system. |
| **AI coding agent** | A coding agent changes one repo well, with the context in front of it. It has no org-wide model, no cross-repo sequencing, no standing governance. Agents are *effectors this system dispatches*, and the model is what makes N agents across M repos coherent. |
| **Orchestration / control plane (Terraform, GitOps)** | These execute *declared* desired state. They do not decide what the desired state should be, predict consequences, or reason about undeclared reality. The model sits above them and emits changes *into* them. |

### 2.3 Terminology recommendation

Drop "executable model" externally. It invites two bad readings: "simulation" (physics
fidelity you cannot deliver) and "self-driving org" (autonomy customers do not want and
should not get). Candidate framings, in order of preference:

1. **"Change plane"** / "governed change plane" — parallels "control plane/data plane,"
   says what it does, implies governance.
2. **"Organizational operating picture"** — for the read side only (military "common
   operating picture" lineage; evidence-backed, live, decision-oriented).
3. Avoid: "digital twin" (fidelity overpromise), "org brain" (creepy), "autopilot"
   (autonomy overpromise).

Internally, the honest loop is **Observe → Model → Plan → Act → Learn** — replacing
"Simulate" with "Plan" is not cosmetic; it disciplines the roadmap away from building a
simulator nobody can validate and toward plans whose predictions get scored.

One addendum the 2025–26 market makes unavoidable: **the model's primary consumer is
increasingly agents, not humans.** Roadie reported agent-to-human interactions on its
platform at 100:1 by April 2026, with ~80% of its own support/on-call load resolved by
agents reading the catalog; every major IDP shipped an MCP server in 2025; Gartner now
names "Agent Experience (AX)" as a discipline (§16). Whatever Orbit builds must be
machine-consumable first — the org model is as much the *context and permission
substrate for a fleet of agents* as it is a UI for people. This strengthens rather than
weakens the thesis: agents without an evidence-backed, permission-aware org model are
exactly the "excessive agency" failure OWASP's agentic top-10 warns about.

---

## 3. Future-state user narratives

### 3.1 The individual developer — retiring an internal API

Maya owns `billing-core` and wants to retire its v1 invoice API. Today this means
grepping org-wide, asking in Slack, and praying. Instead she asks Orbit:

> "What breaks if I remove the v1 `/invoices` endpoints?"

Orbit answers in ~a minute with a **consumer ledger**: 9 known consumers. For each:
the evidence (generated-client import found at `repo/path:line`; Bifrost-observed
consumption of the `invoice-events` topic by a service that also calls v1, last seen 3
days ago; an API-gateway log reference from the connections integration), the owning
team, and last-observed activity. Two entries are flagged **inferred, medium
confidence**: a cron job in a repo with no declared dependency whose code matches the v1
client signature, and residual risk stated plainly: *"v1 is reachable from the partner
gateway; external consumers cannot be enumerated from available evidence — recommend a
30-day deprecation header before removal."*

She clicks **Plan retirement**. Orbit drafts: deprecation-header PR now, per-consumer
migration PRs (it has the v2 client; the diffs are mostly mechanical), sequenced so the
two high-traffic consumers migrate after the low-risk ones prove the pattern, and a
final removal PR gated on Bifrost/gateway showing zero v1 traffic for 14 days. Each PR
carries its evidence and rides the consumer team's normal review. Maya authorizes the
draft-PRs level; the removal PR requires her platform lead's approval — that boundary is
policy, not etiquette.

Six weeks later v1 is gone. Orbit records that its consumer enumeration missed one
consumer (a test harness — caught by the traffic gate, not by a human) and feeds that
error into how it weighs code-search evidence versus traffic evidence next time.

**What was impossible before:** not the grep — the *bounded confidence claim*, the
traffic-gated removal, and the fact that nobody maintained a spreadsheet.

### 3.2 The platform team — an org-wide runtime migration

The platform team must move 180 services from Node 18 (EOL) to Node 22. Today this is a
quarter of spreadsheet archaeology and nagging. Instead:

**Monday.** The lead asks Orbit for a migration plan. Orbit computes the affected set
from lockfiles and Dockerfiles (deterministic), classifies each service by risk using
breaking-change analysis of each service's actual API usage against the Node 18→22
changelog (frontier model over code, cached), deploy frequency (services that ship
weekly can absorb a bad change; the one that ships quarterly cannot), and test-suite
strength (scorecard data). It proposes **five waves**: wave 1 is 40 low-risk,
well-tested, frequently-deployed services; the long tail of scary ones is last, by which
point the playbook is proven. Estimated effort: ~120 mechanical PRs, ~15 requiring human
work, flagged individually with reasons ("uses a native addon with no prebuilt Node 22
binary").

**Tuesday.** The team reviews the plan, moves three services between waves (they know
things Orbit doesn't — Orbit records *why*, as structured corrections), and authorizes
wave 1 at execution level 3: agent-drafted PRs, CI must pass, canary deploy policy
enforced, human merge required.

**Weeks 1–6.** Orbit's agents open PRs in waves. A wave does not start until the
previous wave's services have been deployed and stable for a policy-defined bake period.
Two wave-2 services fail in canary with an undici behavior change Orbit's analysis
missed; it halts the wave, reports the failure signature, updates the risk
classification of 11 downstream services that share the pattern, and re-plans.
The platform team touches ~20 services out of 180.

**Outcome ledger:** predicted 15 human-touch services, actual 22; predicted 6 weeks,
actual 7. Those numbers are now priors for the next migration — and visible to the
customer, which is what makes the *next* authorization easier to grant.

**What was impossible before:** not any single PR — the *sequencing under evidence*,
the halt-and-replan, and a migration whose management cost did not scale with service
count.

### 3.3 The engineering executive — a reorg with eyes open

An EVP is considering dissolving the "integrations" team and distributing its people.
She asks Orbit two questions no tool today answers:

> "What does the integrations team uniquely know, and what do they uniquely keep
> running?"

Orbit answers from behavior, not org charts: 14 services where >80% of meaningful
commits over 24 months come from two specific people; 3 of those services are on the
critical path of order flow (dependency graph + Bifrost traffic); 6 have no runbook and
their incident history shows the same two people resolving every page. It cites each
claim. It estimates — clearly labeled as estimate — that two departures would put ~9
services into "no qualified operator" state, and lists which knowledge is *recoverable
from artifacts* (documented, typed, tested) versus *behavioral only* (resolution
patterns visible in incident timelines but written nowhere).

> "If we proceed, what's the cheapest risk-reduction package?"

Orbit proposes: runbook generation for the 6 undocumented services (agent-drafted from
code + incident history, human-reviewed), ownership transfer sequenced so each receiving
team gets one critical service plus one quiet one, and a 90-day scorecard tracking
whether the receiving teams actually merge changes to their new services (real transfer)
or don't (paper transfer). The EVP proceeds with the reorg — with a risk memo grounded
in evidence instead of a slide written from memory.

**What was impossible before:** the knowledge-at-risk analysis. Nothing stores "what
would we lose if these people left" — it is computable only from the intersection of
commit history, incident behavior, documentation coverage, and dependency criticality,
which is exactly the intersection the model holds.

---

## 4. Previously unanswerable questions

Fifteen questions, each annotated. Ranking follows.

**Q1. If we retire this API/topic/service, what breaks — including undocumented consumers?**
*Hard today:* consumers are discovered by grep + tribal memory; undeclared consumers are invisible.
*Requires:* dependency graph from code (generated clients, SDK imports), traffic evidence (Bifrost, gateways), deploy-time bindings.
*Verifiable:* yes, brutally — retire it and see. Also verifiable cheaply via deprecation-header shadow periods.
*Action after:* generate the retirement plan (§3.1).
*Cost of wrong:* production outage; one bad miss costs enormous trust. Traffic-gated removal converts "wrong" into "delayed."

**Q2. What is the safest sequence for an org-wide upgrade (runtime, framework, base image)?**
*Hard today:* requires per-service risk assessment nobody has time to do; sequencing is alphabetical or political.
*Requires:* affected-set computation (deterministic), per-service risk features (test strength, deploy frequency, API-usage-vs-changelog analysis), wave optimization.
*Verifiable:* yes — the migration happens and the wave failure rates are observable.
*Action:* execute in waves with bake gates (§3.2).
*Cost of wrong:* moderate and contained — a bad wave halts; that's the design.

**Q3. Where will the next serious reliability failure likely emerge?**
*Hard today:* postmortems look backward; risk lives in the intersection of churn, coupling, test weakness, and ownership gaps.
*Requires:* incident history joined to dependency centrality, change rate, scorecard posture, on-call load.
*Verifiable:* statistically, over quarters — not per-prediction. Must be presented as ranked risk, never prophecy.
*Action:* targeted hardening initiatives; scorecard campaigns.
*Cost of wrong:* low if framed as prioritization; catastrophic if framed as prediction and something unlisted blows up. Framing is the product decision.

**Q4. Which business capabilities are implemented redundantly?**
*Hard today:* redundancy is semantic ("three teams built rate limiting"), invisible to any inventory keyed on names.
*Requires:* frontier-model semantic clustering of what code *does*, joined to ownership; human confirmation loop.
*Verifiable:* partially — a human can confirm two implementations are redundant; the *complete* set is unknowable.
*Action:* consolidation proposals with effort estimates.
*Cost of wrong:* low (wasted investigation); consolidation itself is high-cost, so this must rank, not command.

**Q5. What technical knowledge disappears if this team dissolves / this person leaves?**
*Hard today:* knowledge-at-risk is stored nowhere; it's the *intersection* of commit concentration, incident-resolution behavior, and doc coverage.
*Requires:* commit/review history, incident participation, doc coverage per component, dependency criticality.
*Verifiable:* weakly ex ante; strongly ex post (attrition happens and the predicted orphans struggle or don't).
*Action:* runbook generation, ownership transfer plans, targeted pairing.
*Cost of wrong:* low — the remediation (documentation) is cheap and good regardless. Also the narrative that sells to executives (§3.3).

**Q6. Can proposed capability X be assembled from what we already run?**
*Hard today:* requires knowing what every service *actually does*, not what it's named.
*Requires:* semantic capability index over the estate (frontier-model, refreshed on change) + API surface catalog.
*Verifiable:* yes — the assembling team confirms or refutes quickly.
*Action:* scaffold the composition; introduce the owning teams.
*Cost of wrong:* low (a meeting).

**Q7. What single org-wide change generates the most leverage this quarter?**
*Hard today:* nobody can price org-wide changes; candidates are anecdotal.
*Requires:* a priced menu — each candidate migration/consolidation/hardening with effort estimates (calibrated from outcome ledger) and benefit estimates.
*Verifiable:* only after execution, and noisily.
*Action:* this *is* the executive product — the quarterly change portfolio.
*Cost of wrong:* moderate; leverage estimates being 2× off still usually preserves ranking.

**Q8. Which of our stated standards are actually followed, and where is drift concentrated?**
*Hard today:* Orbit's scorecards already partially answer this — but only for *declared, checkable* rules on *cataloged* entities.
*Requires:* extending rules over inferred entities and code-level facts (not just catalog fields).
*Verifiable:* yes, mechanically.
*Action:* drift → automation → governed remediation. **This is the wedge's home turf.**
*Cost of wrong:* low; false positives annoy, gated fixes don't fire.

**Q9. What is the true blast radius of this *proposed PR* before merge?**
*Hard today:* CI tests the repo; cross-repo and cross-service effects (schema changes, shared-library semantics) are invisible until deploy.
*Requires:* interface diffing against known consumers; transitive dependency closure; contract-test coverage map.
*Verifiable:* yes — deploy outcomes score every prediction. Highest-frequency prediction surface available (every PR is a sample).
*Action:* PR annotation → escalate review requirements by computed blast radius.
*Cost of wrong:* low per-instance, and self-correcting because scoring is continuous.

**Q10. Which dependencies (internal and third-party) are load-bearing but unowned or unmaintained?**
*Hard today:* SCA tools see manifests, not centrality or ownership decay.
*Requires:* dependency graph × ownership signals × upstream liveness.
*Verifiable:* yes mechanically for the facts; "load-bearing" needs traffic evidence.
*Action:* adoption/replacement initiatives, prioritized.
*Cost of wrong:* low.

**Q11. Where is the next security failure most likely, and what's the cheapest 80% remediation?**
*Hard today:* scanners produce flat CVE lists with no reachability, exposure, or exploit-path context.
*Requires:* vuln data joined to reachability (is the vulnerable path called?), exposure (internet-facing per gateway/ingress config), and blast radius.
*Verifiable:* remediation is verifiable; the counterfactual breach is not.
*Action:* governed remediation campaigns — the security variant of the wedge.
*Cost of wrong:* deprioritizing a real exposure is severe; must be presented as *additive* prioritization on top of, never replacing, baseline scanner hygiene.

**Q12. What did change X actually cost, end to end, and what will change Y cost?**
*Hard today:* nobody instruments migrations; effort estimates are folklore.
*Requires:* the outcome ledger — predicted vs. actual per executed change. **Only exists if Orbit executes changes.** Bootstrap impossible without the wedge.
*Verifiable:* inherently — it is measurement.
*Action:* calibrated pricing of the change portfolio (feeds Q7).
*Cost of wrong:* self-limiting; miscalibration is visible in the ledger itself.

**Q13. Which services could be deleted?**
*Hard today:* fear. No one can prove a service is unused.
*Requires:* traffic evidence over a long window (Bifrost is ground truth for Kafka; gateway integrations for HTTP) + dependency closure + scream-test tooling.
*Verifiable:* yes — scream tests (governed brownouts) are the verification.
*Action:* decommission plans with staged traffic gates.
*Cost of wrong:* an outage — but scream-testing converts wrong into noisy-but-safe.

**Q14. Is our architecture drifting from its intended shape, and where?**
*Hard today:* intended architecture lives in stale diagrams; actual architecture is emergent.
*Requires:* declared intent (policies, ADRs) diffed against observed structure continuously.
*Verifiable:* the *drift* is a fact; whether it matters is judgment.
*Action:* drift alerts → architectural scorecards → remediation proposals.
*Cost of wrong:* low.

**Q15. What would it take to exit cloud/vendor X, and how would we sequence it?**
*Hard today:* vendor coupling is smeared across code, config, and IAM; estimates are made once, badly, under duress.
*Requires:* coupling inventory (SDK usage, service dependencies, data gravity) + migration cost model.
*Verifiable:* only on execution; partially via spot-checks.
*Action:* standing exit-readiness score; sequenced plan on demand.
*Cost of wrong:* moderate — informs negotiation more often than actual exit, and negotiation tolerates error bars.

### Ranking

Scored 1–5 on customer value, technical feasibility (with Orbit's current assets), defensibility (does answering it compound proprietary data?), and safety (cost of being wrong, inverted — higher is safer).

| # | Question | Value | Feasibility | Defensibility | Safety | Note |
|---|---|---|---|---|---|---|
| Q8 | Standards drift + remediation | 4 | **5** | 4 | 5 | Shipped foundation; wedge |
| Q9 | Pre-merge blast radius | 4 | 4 | **5** | 4 | Highest-frequency scoring surface |
| Q1 | Retirement impact | **5** | 3 | 4 | 3 | Flagship demo; Bifrost advantage |
| Q2 | Migration sequencing | **5** | 4 | 4 | 4 | Wedge's second act |
| Q12 | Change cost ledger | 4 | 4 | **5** | 5 | Only exists if Orbit executes |
| Q5 | Knowledge-at-risk | 4 | 3 | 3 | 4 | Executive door-opener |
| Q13 | Deletable services | 4 | 3 | 4 | 3 | Needs scream-test governance |
| Q11 | Security prioritization + fix | 4 | 3 | 3 | 2 | Crowded market, high wrong-cost |
| Q10 | Unowned load-bearing deps | 3 | 4 | 3 | 5 | Cheap, good filler |
| Q14 | Architecture drift | 3 | 3 | 3 | 5 | Extends scorecards naturally |
| Q7 | Highest-leverage change | 5 | 2 | 4 | 3 | Endgame; needs Q12's ledger first |
| Q3 | Next reliability failure | 4 | 2 | 3 | 2 | Framing risk; needs incident data |
| Q6 | Capability assembly | 3 | 3 | 2 | 5 | Nice, not a business |
| Q4 | Redundant capabilities | 3 | 2 | 3 | 4 | Expensive inference, slow payoff |
| Q15 | Vendor exit | 3 | 2 | 2 | 3 | Episodic demand |

The pattern in the ranking: **the questions that score best are the ones whose answers
get mechanically verified by subsequent execution** (Q8, Q9, Q2, Q12). That is not a
coincidence; it is the thesis.

---

## 5. Proposed organizational model

### 5.1 Entity/relationship core

Orbit already has the entity spine (Payload collections: entities, APIs, repos, teams,
workspaces, scorecards, agent-runs). The model extends it along four axes:

**Entities** (existing + new): Repository, Service/Application, API + Schema, Kafka
topic/consumer-group (Bifrost), Infrastructure resource, Environment, Deployment/Release,
Team, Person, Business capability (inferred, human-confirmed), Standard/Policy
(scorecard rules generalized), Document/Decision, Incident, **Change** (a first-class
record: proposal → plan → execution → outcome), **Prediction** (a claim with confidence,
evidence, and eventually a grade).

**The two genuinely new entity types are Change and Prediction.** Everything else exists
in some catalog somewhere. No competitor treats "a change we predicted and then
executed and then graded" as a durable, queryable object. That object *is* the learning
loop.

### 5.2 Edges: explicit vs. inferred, with provenance as a first-class value

Every edge carries `{source, evidence[], confidence, observedAt, method}`:

- **Declared** (catalog registration, `.orbit.yaml`, ownership fields) — high precision,
  notoriously stale. Confidence decays with age unless re-confirmed.
- **Derived-deterministic** (lockfiles, proto imports, generated-client usage, k8s
  manifests, Terraform state, CI configs) — computed by parsers, not models. This is the
  bulk of the graph and should never touch an LLM.
- **Observed** (Bifrost consumer groups and traffic, deploy events, gateway logs) —
  ground truth for "actually used," the scarcest and most defensible evidence class.
  **Bifrost is the crown jewel here**: because Orbit *is* the Kafka data plane for its
  tenants, it holds runtime dependency truth that metadata-reading portals structurally
  cannot obtain.
- **Inferred** (LLM: "this code implements rate limiting," "this repo appears to consume
  API X via hand-rolled HTTP") — always labeled, always cited to the code span that
  produced the inference, always overridable.

**Conflict handling:** disagreement between evidence classes is not an error to resolve
silently — it is a *finding* (declared owner ≠ observed committer is exactly the Q5
signal). The model stores conflicting claims side by side and lets query-time policy
choose (safety-critical queries weight observed evidence; reporting queries may accept
declared).

**Human corrections** are stored as durable override edges with author and rationale,
never as silent mutations — they are training signal *and* audit trail. A correction
that keeps getting re-applied against fresh inference is a bug report against the
inference method.

### 5.3 Temporality, freshness, invalidation

- Every edge is bitemporal (valid-time + observed-time). "What did the dependency graph
  look like before the incident?" must be answerable.
- Freshness is driven by events where possible (webhooks: push, deploy, incident;
  Bifrost sees traffic continuously) and by scheduled re-scan for the rest — the
  existing catalog-discovery workers and automations sweep worker are precisely this
  machinery.
- Every *answer* the system gives states the staleness of its worst-input ("dependency
  data current as of 2h ago; incident data 3 days"). Silent staleness is how trust dies.

### 5.4 Knowledge that lives only in conversations and behavior

Do not promise to capture Slack. Instead: (a) capture *behavioral* knowledge from
systems of record already integrated — who resolves which incidents, who reviews which
code, which runbooks get opened during pages; (b) make correction/annotation so cheap at
the point of use (one click on any claim: "wrong, because…") that tacit knowledge leaks
into the model at exactly the moments it surfaces; (c) treat agent-run transcripts
(already persisted to `agent-events`) as an owned conversational corpus — the
conversations that happen *inside Orbit* are capturable with clean consent semantics.

### 5.5 Where each technology belongs

| Layer | Technology | Why |
|---|---|---|
| Ingestion, parsing, diffing | Deterministic Go workers (existing discovery pipeline) | Correctness, cost, incremental re-run |
| Graph storage/query | Start: Mongo collections + materialized closure tables; graduate to a graph DB only when traversal patterns demand it | Avoid a premature Neo4j science project; the entity spine is already in Payload |
| Transitive closure, wave planning, diff blast radius | Deterministic algorithms | These are graph problems, not language problems |
| Search/retrieval | MeiliSearch (existing) + embeddings for semantic capability index | Retrieval feeds both humans and models |
| Risk scoring, effort calibration | Boring statistics over the outcome ledger | Small-N regression beats an LLM guess and is explainable |
| Extraction/classification at scale | Cheap models (Haiku-class) | "Does this file use the v1 client?" × 100k files |
| Ambiguity, synthesis, plan drafting, semantic clustering | Frontier models | §6 |
| Execution | Temporal + existing agent + HITL gates | Already built, already audited |

---

## 6. Frontier-model capability analysis

**Tasks for ordinary software (no model at all):** dependency closure; manifest/lockfile
parsing; schema diffing; wave scheduling; policy evaluation; freshness tracking; the
entire execution/approval/audit path. If an LLM is in the loop for any of these, the
architecture is wrong.

**Tasks for inexpensive models (Haiku-class, high volume):** per-file classification
("uses deprecated API?"), commit/incident summarization into structured fields, doc/code
entity extraction, embedding generation, first-pass triage of scan findings. These are
the 100k-call workloads where unit cost dominates.

**Tasks that genuinely require frontier reasoning:**

1. **Undeclared-dependency inference** — recognizing that hand-rolled HTTP calls, queue
   conventions, or a shared database table constitute a dependency requires reading code
   the way a senior engineer does. Weak models produce confident false edges, and false
   edges in a graph that gates deletions are *worse than no edges*. This task was
   effectively unavailable before ~2025-class models.
2. **Breaking-change semantics** — "does this service's actual usage of Node 18 APIs
   intersect the 18→22 breaking set?" is changelog comprehension × code comprehension.
3. **Plan synthesis** — turning a computed affected-set into a sequenced, justified,
   exception-annotated migration plan (the artifact in §3.2) is exactly the
   long-context, multi-constraint synthesis frontier models are differentially good at.
4. **Semantic capability clustering** (Q4/Q6) — "these three modules implement the same
   business function" has no deterministic formulation.
5. **Evidence adjudication** — composing a defensible, calibrated answer from
   conflicting evidence ("declared says A, traffic says B, code says B") with an honest
   confidence statement.

**Decisions that must remain human:** risk acceptance (authorizing any execution level);
production-impacting merges above policy thresholds; org-design actions (§3.3 informs,
never decides); policy/standard content; any override of a halt.

**Where high inference cost is justified:** a one-time $2–10k frontier-model sweep of an
estate to build the inferred-dependency layer is trivially justified against a single
prevented outage or a single migration-quarter saved. The *unjustifiable* pattern is
paying frontier prices continuously for what deterministic diffing should maintain
incrementally — sweep once with the big model, maintain with parsers + cheap models,
re-invoke frontier reasoning only on ambiguity or on-demand planning. Cost scales with
*change*, not with estate size, and that is the difference between a viable COGS story
and a bonfire.

**The honest availability claim:** the read-side graph and the execution plumbing were
buildable in 2023. What changed is that inference tasks 1–5 crossed from "unreliable
demo" to "usable with verification" — and the *verification* is what Orbit's
architecture (traffic gates, CI gates, staged waves, HITL) supplies. Frontier models
did not make the product possible; they made the *inferred half of the graph* and the
*planning layer* possible. The governed-execution half was always possible and almost
nobody built it.

---

## 7. Simulation and execution model

### 7.1 What "simulate" honestly decomposes into

| Class | Method | Example | Error character |
|---|---|---|---|
| **Computable** | Deterministic graph/diff analysis | "These 14 services import the v1 client"; "this schema change is backward-incompatible" | Wrong only if the graph is wrong — errors are auditable to a missing edge |
| **Estimable** | Statistics over the outcome ledger + risk features | "~15 of 180 services will need human work"; "wave 2 has elevated failure odds" | Calibratable; error bars honest after ~10 executed changes of a class |
| **Judgment-shaped** | Frontier-model reasoning, labeled as such | "This service's error handling suggests the undici change will bite" | Must be presented as flagged hypothesis, never as fact |
| **Unknowable** | Refuse | "Will the reorg hurt morale?" | Saying "we don't model this" is a trust feature |

Confidence is communicated per-claim, in evidence-first form ("14 known consumers
[list]; residual risk of unknown consumers: medium, because externally reachable") —
never as a naked percentage, which humans read as either 0 or 100.

**Validation of predictions** is the core mechanism: every plan emits predictions as
structured objects; execution grades them; grades roll up into per-change-class
calibration curves the customer can see. A prediction the system was never held to is
marketing. **Learning from misses:** each miss is classified (missing edge → ingestion
gap; bad estimate → recalibrate; bad inference → prompt/method fix; human override that
proved right → weight correction) and the fix lands in the layer that failed, not in a
vibes-based global adjustment.

### 7.2 Execution authority ladder

| Level | Name | What Orbit may do | Gate |
|---|---|---|---|
| 0 | Observe | Read/ingest/index | Tenant onboarding consent |
| 1 | Answer | Queries, reports, risk rankings | RBAC read |
| 2 | Propose | Draft plans, draft PRs *not opened* | Any member |
| 3 | Stage | Open PRs, run CI, spin test envs; **no merge** | Per-change-class policy; owner ack |
| 4 | Execute-gated | Merge + deploy behind canary/bake policy; auto-halt on regression | Named human approval per wave (existing HITL machinery) |
| 5 | Execute-standing | Pre-authorized change classes (e.g., patch-level dep bumps with passing CI) run without per-instance approval | Written standing policy + kill switch + budget/blast caps |

Non-negotiable properties, most of which Orbit's agent/Temporal stack already implements
in embryo: idempotent activities; every action attributable (which plan, which approval,
which evidence); rollback plan required *before* level-4 execution, not after failure;
wave halts are automatic and halt-resumption is a human decision; per-tenant kill
switch; execution rate caps ("no more than N services touched per day") as policy
objects. Level 5 exists only per change-class, earned by ledger history in *that* class
— standing authority is granted to a track record, not to the product.

### 7.3 What Orbit executes first — and deliberately not

Start with change classes where verification is mechanical: dependency/runtime bumps
(CI + canary verify), config/manifest standardization (scorecard re-check verifies),
Kafka schema/client migrations (Bifrost observes the outcome directly). Explicitly defer
behavior-changing refactors, data migrations, and anything whose verification requires
human semantic judgment — those are where one failure destroys the trust the ledger is
trying to build.

---

## 8. Entry-wedge comparison

Five candidates evaluated. Scores 1–5, higher better; "Wrong-output cost" inverted
(5 = mistakes are cheap/contained).

| Criterion | A. Change-impact analysis (Q1/Q9) | B. Migration planning (Q2, plan-only) | C. **Governed remediation (Q8→act)** | D. Drift detection (Q14) | E. Dependency/ownership discovery (Q10/Q5) |
|---|---|---|---|---|---|
| Problem urgency | 4 | 4 | 4 | 2 | 3 |
| Economic value | 4 | 4 | 5 | 2 | 3 |
| Integration burden (5=light) | 2 | 3 | 4 | 3 | 3 |
| Time to credible result | 2 | 3 | 4 | 4 | 3 |
| Verifiability of output | 3 | 2 | **5** | 4 | 3 |
| Wrong-output cost (5=cheap) | 2 | 3 | 4 | 5 | 4 |
| Competitive whitespace | **5** | 3 | 2 | 2 | 2 |
| Expansion path to full vision | 4 | 4 | 5 | 3 | 3 |
| Compounding data advantage | 3 | 3 | **5** | 2 | 3 |

A note on the whitespace scores, which look paradoxical: A (what-if impact analysis) is
the *emptiest* territory — the landscape sweep (§16) found no commercial product doing
pre-execution simulation over an org-wide dependency/ownership graph — while C (governed
execution) is now *crowded*: OpsLevel's Tidra, Sourcegraph Agentic Batch Changes,
Moderne Moddy, Amazon Q Transform, and Port's agentic platform all ship some form of
plan-once/execute-everywhere with human gates. The resolution of the paradox is that
**A is empty because it is unreachable directly** — credible simulation requires
calibration data that only execution produces — and **C is crowded but undifferentiated
on exactly the axis Orbit can own**: nobody in C grades predictions, nobody closes the
loop from continuous drift detection, and nobody holds observed-traffic evidence. C is
the contested beachhead; A is the undefended high ground behind it.

**Why not A (impact analysis) first, despite the whitespace:** its demo is spectacular, but
its first production question ("what breaks if I retire X?") is exactly the one where a
single miss is an outage attributed to Orbit. It needs the *most complete* graph on day
one — completeness is the hardest property to bootstrap — and until an org acts on the
answers, nothing verifies them, so the data advantage doesn't compound. It is the
right *second* product, once executed changes have been back-filling and stress-testing
the graph.

**Why not B (plan-only migration planning):** a plan nobody executes through the system
is a consulting deliverable. Effort estimates can't calibrate without execution data.
It also has a devastating failure mode: the customer takes the plan and executes it with
Copilot, keeping all the learning.

**Why not D/E:** cheap to build, cheap to copy, already partially commoditized by
incumbents (ownership/dependency features in Cortex/Port; drift is a scorecard feature,
which Orbit already ships). They are *features of* the wedge, not wedges.

---

## 9. Recommended wedge: Governed Remediation

**One sentence:** *Scorecards that fix themselves, under policy* — Orbit detects drift
against a standard, drafts the fix, routes it through the authority ladder, verifies the
outcome mechanically, and records predicted-vs-actual in the ledger.

**Why this one, beyond the scorecard math above:**

1. **It is the shortest path from shipped code to new category.** Scorecards, the
   automations trigger system ("rule-result-changed → action"), the agent with HITL
   approvals and audit, and Temporal durability all exist in production. The missing
   pieces are the remediation-drafting layer, the authority-ladder policy objects, and
   the prediction/outcome records — weeks-to-months, not years.
2. **Every unit of work is self-verifying.** A remediation PR either passes CI and
   merges or it doesn't. Trust accrues per-PR at low stakes, which is the only way a
   small vendor earns level-4 authority. Contrast: impact analysis asks for trust
   *before* delivering value.
3. **It compounds.** Each executed remediation back-fills graph edges (you learn the
   real dependency structure of every repo you touch), calibrates effort models, and
   grows the ledger that makes migration planning (the second act) credible and priced.
4. **It generalizes cleanly.** "Standard: no EOL runtimes" + governed remediation *is*
   the §3.2 migration product — a migration is just a big, sequenced remediation
   campaign. The wedge and the vision are the same machine at different scales.
5. **Competitive positioning is sharp but must be honest:** "initiatives that execute"
   alone is no longer enough — Tidra, Sourcegraph, and Moddy execute too (§16). Orbit's
   claim within the crowd is threefold: (a) the **closed loop** — detection (scorecards),
   execution, and verification live in one governance envelope, where Tidra is notably a
   *separate product* from OpsLevel's portal and Sourcegraph has no standards/drift
   layer at all; (b) the **graded ledger** — Orbit is the only one that shows customers
   its own prediction accuracy, which is both a trust weapon and the moat (§11);
   (c) **evidence depth** — Bifrost traffic and cross-forge (GitHub + ADO) reality that
   code-search-first competitors lack. Notably, the entire field has converged on the
   same execution pattern (plan once → per-repo agents → deterministic verification
   gates → human PR review → staged rollout — Google's Rosie, Airbnb's test migration,
   Stripe's Minions all describe it), which confirms the pattern is right and means
   differentiation lives in the *model and ledger*, not the execution mechanics.

**Scope discipline for v1:** three change classes only (runtime/dependency bumps;
CI/manifest/config standardization; Kafka client/schema migrations via Bifrost — the
uncopyable one). GitHub + ADO (both integrations exist). Authority levels 0–4; level 5
only for patch-level bumps after a tenant accrues ledger history.

---

## 10. The AI-ready factory (absorbing 10×–1000× machine-generated change)

The Stripe-style lesson: generation is not the bottleneck; **absorption** is. At 10× PR
volume the constraints shift, in order:

1. **Human review attention** — the first wall. At 100×, per-PR human review is
   arithmetic nonsense. Review must restructure from *per-change* to *per-policy*:
   humans review and authorize the *change class and its verification recipe once*
   (level-5 standing policy); machines verify instances; humans audit samples and
   exceptions. This inverts the review pyramid — it's how manufacturing QA scaled, and
   the authority ladder (§7.2) is exactly the container for it.
2. **CI capacity and flakiness** — at 100 PRs/day, a 2% flake rate poisons the
   verification signal that the whole model depends on. Flake quarantine and test-suite
   strength become *prerequisites Orbit must assess per-repo* (a scorecard!) before
   admitting a repo to higher execution levels.
3. **Verification depth** — CI-passing is necessary, not sufficient. Absorbing real
   volume needs contract tests at service boundaries, ephemeral environments, canary +
   automated rollback. Most mid-size orgs have fragments of this.
4. **Merge/deploy serialization** — wave scheduling, deploy windows, freeze awareness
   as policy objects, not tribal knowledge.
5. **Incident triage attribution** — at high change volume, "which change caused this?"
   must be answerable in seconds, which the Change entity (§5.1) provides by
   construction.

**Is the factory itself a product?** Partially. Orbit should ship: the **absorption
scorecard** (rates each repo's readiness — test strength, flake rate, canary coverage —
and gates execution levels on it, turning a safety requirement into a sales motion:
"here's exactly what blocks you from more automation"), policy-as-code for change
classes, and the audit/ledger surface. Orbit should **not** build CI infrastructure,
ephemeral-environment tech, or deployment tooling — that's a different company
(Buildkite/Depot/Vercel territory) and a scope trap. Orbit *measures and gates on* the
factory; it doesn't manufacture the machine tools.

---

## 11. Defensibility

**Real moats, in descending order:**

1. **The outcome ledger.** Predicted-vs-actual across executed org-scale changes exists
   nowhere else and cannot be scraped, licensed, or shortcut — it accrues only by
   executing changes under measurement. Every quarter of operation deepens per-tenant
   calibration a competitor starts at zero on.
2. **Observed-traffic evidence via Bifrost.** Orbit sits in the Kafka data path;
   dependency truth from traffic is structurally unavailable to metadata-reading
   portals. Narrow (Kafka-shaped orgs) but deep, and it points at the generalization:
   own or integrate the choke points where usage is observable (gateways, service mesh,
   deploy systems).
3. **Standing execution authority.** A tenant that has granted level-4/5 authority,
   wired approval policies into its org structure, and accumulated audit history has
   switching costs far beyond data export — trust is granted to a track record
   (§7.2), and track records don't transfer between vendors.

**Weak or temporary moats, stated plainly:** the graph itself (any funded competitor
rebuilds declared + derived layers in quarters; inference is rentable from the same
model vendors); workflow integrations (table stakes); "AI features" (zero moat — the
models are everyone's); single-tenant trust without cross-tenant learning (real but
doesn't compound across customers). Cross-customer learning of *change-class priors*
(anonymized calibration: "Node 18→22 breaks ~8% of services, these patterns predict
which") is potentially strong but must be designed consent-first from day one —
bolting privacy on later kills it.

**The uncomfortable truth:** this lane is already funded and moving. GitHub sits on the
repos, CI, review surface, and agent (Copilot) — if it decides "governed org-wide change
campaigns" is a feature, it has every distribution advantage. Port raised $100M at $800M
in December 2025 explicitly to become an "agentic engineering platform" with a Context
Lake and guardrails; Atlassian paid ~$1B for DX and bundles Compass with an AI coding
agent; OpsLevel spun out Tidra to chase mass-change execution; Sourcegraph's Agentic
Batch Changes went public beta in June 2026 (§16). The market has validated the category
and compressed the window. Orbit's defenses are speed to the *ledger* (nobody is grading
predictions yet), cross-forge/on-prem reality (ADO + GitHub together is already Orbit's
lane; big-org estates are heterogeneous), data-plane evidence (Bifrost), and depth in
the governance/audit layer that platform teams buy and code-tool vendors underserve —
a positioning the DORA 2025 finding supports directly (AI lifted individual productivity
+19% but org throughput only +3% with delivery stability *down* 9%; the binding
constraint is governed absorption, which is Orbit's thesis). This is a real race, not a
protected niche.

---

## 12. Pre-mortem — it is 2029 and this failed

| # | Failure mode | Early warning signal | Cheap test now |
|---|---|---|---|
| 1 | **Graph too stale/incomplete; one bad answer nuked trust** | Correction rate on inferred edges >20%; users stop clicking evidence links | Shadow-predict impact of 20 *historical* changes; measure precision/recall before any customer sees a claim |
| 2 | **Integration burden exceeded appetite** — every prospect needed 5 systems wired before value | Sales cycles stall at "security review of the 4th integration" | Define the minimum-integration wedge (GitHub/ADO only) and verify it delivers standalone value on a design-partner estate |
| 3 | **Nobody granted execution authority** — stuck at level 2 forever, became a reporting tool | Design partners approve PR-drafting but merge manually for months; ledger stays empty | Instrument authority-level progression per tenant from day one; treat level-3→4 conversion as *the* north-star metric |
| 4 | **A level-4 execution caused a visible outage** | Any halt-override or rollback failure in early tenants | Chaos-test the halt/rollback path before granting level 4 to anyone; wave caps small by default |
| 5 | **Inference COGS ate the margin** — whole-estate frontier sweeps priced like consulting | Per-tenant model spend not declining after onboarding sweep | Cost the sweep-once/maintain-cheap architecture on a real 200-repo estate before pricing |
| 6 | **No buyer** — platform team loved it, had no budget; CTO wouldn't sponsor | Champions can't name whose budget pays | Willingness-to-pay interviews *now* (§13.6); price against migration-quarter cost, not per-seat portal math |
| 7 | **Time-to-value too long** — 6 weeks of ingestion before first useful answer | Trial-to-paid conversion dies at onboarding | First remediation PR must land within 48h of connect; design onboarding around one repo, one standard, one fix |
| 8 | **An incumbent shipped 80% of it as a checkbox** — GitHub/Copilot campaigns, Port's Context Lake maturing into execution, Tidra folding back into OpsLevel, Atlassian bundling Rovo+Compass+DX | Incumbent announcements of org-wide-change or prediction-grading features | Watch the specific gap that matters: none of them grades predictions or closes the drift→fix loop; if one does, the window is closing — accelerate or reposition to the evidence/governance layer |
| 9 | **Great demo, no durable workflow** — usage spiked at eval, decayed after | WAU on answers flat; remediation PRs/tenant/week declining after month 2 | Concierge test (§13.1) measures *repeat* usage, not wow |
| 10 | **Security posture blocked adoption** — org-wide read + write authority was an un-sellable risk ask | Security questionnaires kill deals; tenants demand read-only forever | Design the permission story first: per-change-class scopes, customer-held keys, on-prem execution runners; get one real CISO to review the design *before* building it |

Meta-signal across all ten: **the ledger is the canary.** Nearly every failure mode
shows up first as "the outcome ledger isn't growing." If executed-and-graded changes
per tenant per month is rising, the thesis is working; if it's flat, no amount of demo
polish matters.

---

## 13. Discovery experiments (sequenced, cheap-first)

1. **Concierge remediation (2–3 weeks, ~zero build).** Hypothesis: a platform team will
   adopt drift-fix PRs produced under governance. Procedure: manually run the wedge
   loop on one friendly org (Orbit's own estate + the sponsor org): pick one standard,
   have Claude draft fixes, route via existing HITL approvals, track outcomes in a
   spreadsheet-ledger. Success: >70% of drafted PRs merged within 2 weeks; the team asks
   for a second standard. Failure: PRs rot unreviewed → the absorption problem (§10) is
   real and first. Informs: wedge go/no-go.
2. **Shadow blast-radius (1–2 weeks, read-only).** Hypothesis: the graph + inference can
   enumerate change impact accurately. Procedure: take the last 20 merged breaking-ish
   changes in a real estate; have the pipeline predict impact from pre-change state;
   grade against what actually happened. Success: recall >90% on known-broken consumers,
   precision >70%. Failure: recall <70% → the graph can't be trusted to gate anything;
   invest in ingestion before any customer-facing claim. Informs: whether impact
   analysis can ever be more than decoration.
3. **Frontier scouting sweep (1 week, ~$500–2k inference).** Hypothesis: frontier models
   find real undeclared dependencies at useful precision. Procedure: sweep one estate for
   inferred edges; human-adjudicate a 100-edge sample. Success: >80% precision on
   high-confidence edges. Failure: <50% → inferred layer must be demoted to
   "suggestions," changing the product claims materially. Informs: how loudly the
   "undocumented consumers" story can be told.
4. **One real org-wide change (4–6 weeks, design partner).** Hypothesis: wave-planned,
   gated execution beats the status quo enough that the team grants level 4. Procedure:
   run one genuine migration (an EOL runtime bump is ideal) through plan → waves → gated
   merges on a partner estate. Success: >60% of PRs merged without human edits; partner
   authorizes level 4 by the final wave; predicted-vs-actual within 2×. Failure: partner
   insists on manual everything → trust ladder is too steep as designed. Informs:
   whether the execution business exists.
5. **Verification-infrastructure audit (1 week, questionnaire + scan).** Hypothesis:
   target customers' CI/canary maturity can absorb machine change. Procedure: assess 5
   prospect estates against the absorption scorecard (flake rate, contract tests, canary
   coverage). Success: ≥3 of 5 can safely absorb level-3 today. Failure: absorption
   readiness is rare → the scorecard/factory product (§10) must *lead*, not follow.
6. **Willingness-to-pay (2 weeks, concurrent).** Hypothesis: this is priced against
   migration cost, not portal seats. Procedure: 10 interviews with platform/eng leaders;
   present the §3.2 narrative; probe budget line, buyer, and price anchors
   (vs. "a quarter of 4 engineers on a migration" ≈ $150–300k). Success: ≥3 leaders name
   a real budget and a number ≥$50k/yr. Failure: everyone routes it to the portal budget
   (≤$20k) → revisit whether this is a feature of Orbit-the-platform rather than a
   product. Informs: pricing model and whether to raise ambition or fold it in.

Order matters: 1, 2, and 6 run first and in parallel; 3 feeds 2; 4 only after 1–2 pass;
5 alongside 4.

---

## 14. Staged strategic path

**Stage 0 — now (foundation is largely shipped):** scorecards, automations, HITL agent,
Temporal, GitHub/ADO connections, Bifrost. Add: Change and Prediction entities; the
spreadsheet-grade outcome ledger; run experiments 1–3, 6.

**Stage 1 — Catalog → Model (quarters 1–2):** derived-deterministic edge extraction
(lockfiles, generated clients, manifests) on the existing discovery pipeline; Bifrost
traffic edges; provenance + confidence on every edge; evidence-cited answers for Q8, Q9,
Q10 read-only. Exit criterion: shadow blast-radius (exp. 2) passes on a real estate.

**Stage 2 — Model → Planning (quarters 2–3):** wedge GA — governed remediation on three
change classes, authority levels 0–4, absorption scorecard, per-tenant ledger visible to
the customer. Exit criterion: one tenant at level 4 with ≥50 graded changes.

**Stage 3 — Planning → Campaigns (quarters 3–5):** migration campaigns (§3.2) as
productized sequenced remediation; frontier-inference layer promoted from suggestions to
gated claims where experiment 3 precision holds; impact-analysis product (Q1) launched
*on top of* the by-now execution-hardened graph. Exit criterion: one full org-wide
migration executed end-to-end with predicted-vs-actual within 2×.

**Stage 4 — Campaigns → Portfolio (year 2+):** the executive surface — priced change
portfolio (Q7), knowledge-at-risk (Q5), calibrated cross-tenant priors (consent-first).
Level-5 standing authority for earned change classes.

At every stage the read-side products ship *behind* the execution products, because
execution is what verifies the reads.

---

## 15. Final recommendation

**Strongest version of the thesis:** Orbit stops competing on describing the org
(a fight Cortex/Port/GitHub win on distribution) and becomes the system through which
org-wide software change is planned, authorized, executed, and measured — the change
plane. The catalog is demoted to sensory input. The moat is the outcome ledger plus
standing execution authority, both of which accrue only through operation and transfer
to no competitor. Orbit's June strategy already stripped it to exactly the right
chassis for this: the governed agent, scorecards/automations, Temporal, and Bifrost.

**Strongest argument against:** this is a trust business attempted from near-zero
footprint in a lane the largest developer-tools company on earth (GitHub) can enter as
a feature, and the wedge's economics depend on customers granting write authority that
security teams are paid to refuse. If authority-level progression stalls (pre-mortem
#3), Orbit will have built an elaborate reporting tool with extra steps. The
counter-bet is that per-PR mechanical verification plus audit-grade governance earns
authority faster than incumbents choose to move — plausible, unproven.

**Initial wedge:** governed remediation (§9). **Key capability Orbit must own:** the
prediction/outcome ledger and the authority-ladder policy engine — everything else can
be rented, integrated, or rebuilt by others. **Deliberately do not build:** CI/test
infrastructure, ephemeral-environment tech, observability, a general coding agent, chat
UX over docs, or a simulator that claims fidelity it can't score.

**Three assumptions to test first (all cheap, all this quarter):**
1. Teams merge machine-drafted remediation PRs at high rates and come back for more
   (experiment 1).
2. The graph can achieve gate-worthy recall on change impact (experiment 2).
3. Someone will pay migration-anchored, not portal-anchored, prices (experiment 6).

**The demonstration that turns a skeptic:** put an engineering leader's *own estate* on
screen. Ask Orbit to retire a real internal API. Watch it produce the consumer ledger —
including one consumer nobody in the room knew about, with the code citation and the
traffic evidence — then draft the sequenced retirement plan, open the first PR, and
show the policy gate that says his name as the required approver of the removal step.
The moment is not the plan; it's the *unknown consumer with evidence*. That is the
thing no person and no tool in the room could have produced, and it converts "nice
catalog" into "I did not know this was possible."

---

## 16. Appendix — competitive landscape with citations (researched 2026-07-10)

### 16.1 IDP incumbents' AI positions

| Vendor | Position as of mid-2026 | Sources |
|---|---|---|
| **Spotify / Backstage** | AiKA RAG assistant for Portal customers (KubeCon EU 2025); used by 87% of Spotify developers; now triggers Portal actions via MCP. OSS Backstage ships an official MCP actions plugin. No simulation. | [The New Stack, May 2025](https://thenewstack.io/introducing-aika-backstage-portal-ai-knowledge-assistant/), [TechCrunch, May 2025](https://techcrunch.com/2025/05/04/backstage-access-spotifys-dev-tools-side-hustle-is-growing-legs/), [backstage mcp-actions-backend](https://github.com/backstage/backstage/tree/master/plugins/mcp-actions-backend) |
| **Port** | Rebranded "Agentic Engineering Platform" (late 2025): "Context Lake," guardrails, agents as first-class platform users. **$100M raise at $800M valuation, Dec 2025** (Accel) to fund the pivot. Governed execution, no simulation, no prediction grading. Capabilities per Port's own marketing; no independent evaluation found. | [Port blog](https://www.port.io/blog/port-agentic-engineering-platform), [SiliconANGLE, Dec 2025](https://siliconangle.com/2025/12/11/port-nets-100m-turn-developer-portal-agentic-ai-hub/) |
| **Cortex** | "Mission control for the AI software factory." Magellan (Oct 2025): AI auto-builds the catalog, infers ownership. MCP server GA. Still catalog/scorecards/insights — no execution engine, no simulation. $60M Series C @ ~$470M (Sept 2024). | [Cortex Magellan](https://www.cortex.io/post/introducing-magellan-the-ai-data-engine-that-builds-your-idp), [SiliconANGLE, Sept 2024](https://siliconangle.com/2024/09/04/productivity-platform-startup-cortex-raises-60m-strength-platform-capabilities/) |
| **OpsLevel** | AI catalog enrichment + MCP server. Spun out **Tidra** (tidra.ai): standalone agent for org-wide code changes (dependency upgrades, CVE patches, CI/CD migrations) with CODEOWNERS-routed review — the closest competitor to the §9 wedge, notably shipped *outside* the portal. | [OpsLevel AI](https://www.opslevel.com/ai), [Tidra](https://tidra.ai/) |
| **Atlassian** | Compass in the Atlassian MCP Server; Rovo Dev coding agent GA 2025, bundled with Compass + Bitbucket + DX. **Acquired DX for ~$1B** (closed Nov 2025) — largest Atlassian acquisition ever. | [SiliconANGLE, Oct 2025](https://siliconangle.com/2025/10/08/atlassian-gives-rovo-ai-major-upgrade-developers-new-tools/), [TechCrunch, Sept 2025](https://techcrunch.com/2025/09/18/atlassian-acquires-dx-a-developer-productivity-platform-for-1b/) |
| **Harness** | "IDP Knowledge Agent" on a software-delivery knowledge graph — the closest incumbent articulation of a connected org model as AI substrate. Agentic release orchestration + FinOps agents (Sept 2025); markets against the DORA 2025 stability gap. | [Harness blog](https://www.harness.io/blog/the-ai-knowledge-agent-making-internal-developer-portals-smarter), [SiliconANGLE, Aug 2025](https://siliconangle.com/2025/08/26/harness-deploys-ai-agents-automate-every-aspect-software-delivery-code-generation/) |
| **Roadie** | Six MCP servers over the Backstage catalog. Reported **100:1 agent-to-human interaction ratio** and ~80% of its own support/on-call resolved by agents (BackstageCon EU, Apr 2026) — strongest empirical signal that agents are the catalog's new consumer. | [Roadie MCP](https://roadie.io/blog/announcing-the-roadie-mcp/), [BackstageCon EU recap, Apr 2026](https://tldrecap.tech/posts/2026/backstagecon-europe/backstage-agentic-future/) |

### 16.2 Mass-change / migration platforms

- **Moderne / OpenRewrite** — $30M Series B (Feb 2025); OpenRewrite recipes embedded in
  Amazon Q, Copilot app-modernization, Broadcom App Advisor. **Moddy** (Mar 2025):
  multi-repo AI agent — LLM plans, deterministic recipe engine executes.
  [TechCrunch](https://techcrunch.com/2025/02/11/moderne-raises-30m-to-solve-technical-debt-across-complex-codebases/),
  [GlobeNewswire](https://www.globenewswire.com/news-release/2025/03/04/3036560/0/en/Moderne-Unveils-Moddy-The-First-Multi-Repository-AI-Code-Agent-for-Analyzing-and-Evolving-Large-Codebases.html)
- **Sourcegraph Agentic Batch Changes** — public beta June 30, 2026: prompt → code-search
  discovery → validate in one repo → expand → react to CI → human approval per
  changeset. [sourcegraph.com/batch-changes](https://sourcegraph.com/batch-changes)
- **Google Rosie / LSC process** — the reference architecture: shard, test, review,
  submit; formal review committee since 2013.
  [SWE at Google, ch. 22](https://abseil.io/resources/swe-book/html/ch22.html)
- **Amazon Q / AWS Transform** — Java upgrades; cited 42% time savings in a
  financial-services workshop. [AWS](https://aws.amazon.com/q/developer/transform/)
- **Airbnb** — 3.5K Enzyme→RTL test files in 6 weeks vs. est. 1.5 engineer-years, 97%
  automated; key technique was staged verification gates with LLM retry, not clever
  prompting. [Airbnb Engineering, Mar 2025](https://medium.com/airbnb-engineering/accelerating-large-scale-test-migration-with-llms-9565c208023b)
- **Stripe "Minions"** — unattended agents merging ~1,000–1,300 AI-authored PRs/week;
  a ~50M-line Ruby migration reportedly completed in about a day. *Caveat: figures come
  from a conference talk and aggregator coverage, not first-party Stripe engineering
  posts — treat as reported, not verified.*

**Convergent pattern across all of the above:** plan once → per-repo agents →
deterministic verification gates → bounded retries → human review in normal PR flow →
staged rollout. Verification infrastructure, not model quality, is where everyone says
the differentiation lives — independent confirmation of §10.

### 16.3 Impact analysis / architecture intelligence

- **CAST Imaging** — architectural graphs sold for impact analysis; MCP server (GA after
  Aug 2025 beta) positioning architecture intelligence as an *agent guardrail*.
  [CAST](https://www.castsoftware.com/news/ai-can-now-understand-and-transform-big-enterprise-codebases)
- **vFunction** — architectural-drift observability; their 2025 survey: **56% of IT
  pros admit production no longer matches architecture docs** — a direct argument for a
  continuously updated model. [vFunction](https://vfunction.com/use-cases/architectural-drift/)
- **CodeScene** — behavioral code analysis; 2025 study: AI-generated changes fail far
  more often in unhealthy code; CodeHealth MCP server gives agents change-risk signals.
  [CodeScene](https://codescene.com/product/code-health-mcp)
- **Gartner "Digital Twin of an Organization"** — exists as a market guide for business
  process/EA; **no product applies DTO to software engineering orgs by name.** The
  nearest neighbors (Harness's delivery knowledge graph, Port's Context Lake) do not
  simulate. Unclaimed framing.

### 16.4 Market signals

- Gartner Market Guide for IDPs (Mar 2025): 85% of platform-team orgs will run an IDP by
  2028 (60% in 2025); Backstage the "Kubernetes of IDPs."
  [Gartner](https://www.gartner.com/en/documents/6306515)
- Gartner: 80% of large orgs will have platform teams by 2027 but **<30% will show
  measurable productivity gains** — the value-proof gap this memo's ledger directly
  addresses.
- **DORA 2025**: AI +19% individual productivity, +3% org throughput, **−9% delivery
  stability** — the strongest third-party argument that governed absorption is the
  binding constraint.
- **OWASP Top 10 for Agentic Applications** (Dec 2025) names "excessive agency" for
  agents that commit code/trigger deploys — external validation of the authority ladder.
- "Agentic SDLC" is now a named category (PwC 2026: >50% of teams fully agentic by 2027
  — treat vendor/consultancy forecasts with appropriate salt).
- *Verification caveats:* Gartner Hype Cycle content is paywalled and characterized here
  via vendor summaries; Port's Context Lake claims are self-reported; Stripe figures as
  noted above.

### 16.5 The one-line competitive summary

Every incumbent shipped an MCP server and an assistant (2025 made both table stakes);
three credible players ship governed mass-change execution; **nobody simulates change
impact over an org-wide graph, and nobody grades their own predictions.** The whitespace
is exactly the part of the thesis that only an execution ledger can reach — which is why
the wedge (§9) is execution-first even though the endgame (§14, Stage 3+) is the
impact/planning layer.
