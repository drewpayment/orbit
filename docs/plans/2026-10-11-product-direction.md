# Orbit product direction: self-service for application developers

**Date:** 2026-10-11
**Status:** Decided by Drew 2026-10-11. Supersedes parts of [2026-06-09-product-focus-strategy.md](./2026-06-09-product-focus-strategy.md) (see section 2).
**Companion plan:** [2026-10-11-deploy-ci-foundation.md](./2026-10-11-deploy-ci-foundation.md)

## 1. Context

The June strategy was written when Orbit's role was undecided (portal vs. platform layer next to a purchased portal) and the plan was to protect what "survives a vendor purchase": Bifrost (Kafka proxy) and the infra agent. Four months of work went somewhere else: `git log` on main since 2026-06-09 shows 0 commits touching `services/bifrost` and 2 touching `services/kafka`, against 18 on template authoring/scaffolder, 10 on scorecards, 5 on catalog discovery. The product that actually exists is a self-service developer portal built around templates, discovery and scorecards. This record makes that explicit and fixes the order of work.

## 2. What this supersedes or confirms from the June strategy

| June position | Now |
|---|---|
| Bifrost is the flagship, "finish Phase 6 metrics" | **Superseded.** Kafka/Bifrost stays as one *offering* a platform team can expose, not the product's identity. No new Bifrost feature work until the core journey is solid. |
| Orbit's role undecided (baseline for vendor evaluation vs. platform layer) | **Decided.** Orbit is the portal. Application developers are the user; platform teams administer it. |
| Scorecards/standards: proposal only, pending #45 force-ranking | **Decided by shipping.** Scorecards, entity scores, golden-path rules, scheduled evaluation and reports exist (plans dated 2026-07-01 through 2026-07-15). Treat #45 as resolved for scorecards; cost visibility remains uncommitted. |
| Patterns catalog + templates: "polish only" | **Superseded.** Template authoring (Phases 0-4), example templates and catalog discovery are now the core self-service path. |
| Infra agent: reposition as AI governance | **Confirmed**, narrowed: governed agent actions with human approval are the last step of the core journey, not a separate product. |
| Strip AWS/GCP launches, plugins service, Backstage backend | **Confirmed and done** (tag `archive/pre-strip-2026-06-10`). Cloud launches: Azure and DigitalOcean only. |
| Registry and health monitoring frozen | **Confirmed.** Still frozen. |
| Productivity measurement is a non-goal | **Confirmed.** |
| Security sequencing (fail-open secrets, IDOR, gRPC auth interceptor) | **Confirmed, still incomplete.** The new audit round (section 4, item 1) finishes it. |

## 3. Decision

Orbit is an enterprise developer portal where **application developers self-serve against the cloud accounts, technology offerings and standards that their platform team has procured and curated**. Platform teams do not use Orbit to build software; they use it to *administer* what developers are allowed to self-serve.

## 4. Order of work

1. **Security lockdown** (in progress, parallel PRs): Users collection access and role escalation; unauthenticated API routes; unauthenticated server actions and knowledge identity; credential encryption and field hiding; Go gRPC object-level authz and Bifrost admin auth.
2. **Deploy and CI foundation** (plan only for now): production secret contract, one required CI gate, backups, minimum observability. See the companion plan.
3. **Hide every non-working surface behind feature flags and make the README accurate** (in progress).
4. **Later:** onboarding, hosted trial, design partners. Not started until 1-3 are done; a trial exposes the product to strangers, which is only safe with the lockdown and CI gate in place.

## 5. Personas and jobs-to-be-done

**Application developer (the user).** A software engineer in a workspace that belongs to one or more teams.
- Find what exists: which services, APIs, topics and docs are already in the catalog, who owns them, and whether they meet standards.
- Start something new correctly: pick a template or an offering (a repo skeleton, a Kafka topic, an Azure resource) and get a working, compliant result without filing a ticket.
- See where my services stand: scorecard results and what to fix next.
- Delegate toil to an agent *with oversight*: ask for an infrastructure or repo change and approve what it will do before it does it.

**Platform admin (the administrator).** A member of a platform/DevOps team who is workspace admin or platform admin.
- Curate the paved road: author and version templates, decide which are visible to which workspaces.
- Connect and bound the supply: GitHub/Azure DevOps connections, cloud accounts, Kafka clusters and offerings, with credentials stored safely.
- Set the rules: scorecards, policies, approval requirements, agent permissions.
- See adoption and drift: which teams use the paved road, which services fail standards, what is pending approval.
- Keep it running: the platform team is also the operator of an Orbit install.

## 6. Core journey

1. **Discover / catalog.** Repos and APIs are found by discovery scan or registered by hand and land in the catalog with an owner.
2. **Self-serve.** The developer instantiates a template or requests an offering (topic, cloud resource). Approval gates apply where the admin configured them.
3. **Appears in the catalog with a scorecard.** Anything created through Orbit is registered automatically and scored against the golden-path rules from day one.
4. **Governed agent actions.** Further changes can be delegated to the agent; every mutating step passes a human approval gate and is audited.

Everything in the product should either be a step in this journey or administration of it. What is not, goes behind a flag.

## 7. Out of focus for now

- New Bifrost/Kafka capabilities beyond what the journey needs (chargeback UI, offset recovery, schema-validation workflows).
- Container registry and health monitoring (frozen); AWS/GCP; plugins; Backstage.
- Cost visibility per team (uncommitted; revisit after scorecards have real usage).
- Engineering-productivity metrics (permanent non-goal).
- Hosted trial, billing, public onboarding (item 4 above).
- Multi-region, HA and autoscaling. The goal for deploy work is *correct and recoverable*, not scalable.

## 8. Open questions

1. **Who is the first real install?** Hoytlabs (orbit.hoytlabs.app) only, or a design partner? Determines how much of the onboarding story is needed and when.
2. **Buy vs. build for the portal layer.** June left this open; this record assumes build. If a commercial portal is still being evaluated by the sponsor, say so now, because it changes how much catalog UI polish is worth.
3. **Scope of "offerings."** Today: templates, Kafka topics, Azure/DigitalOcean launches. Is a single "offerings" abstraction (curated, approvable, scorecard-linked) the next product concept, or do templates stay the only front door?
4. **Which surfaces stay visible after the flag pass?** Needs an explicit list owned by the feature-flag workstream so the README and the UI agree.
5. **Agent trust boundary.** Which actions may the agent take without approval in a self-service context (read-only, scaffold into a sandbox), and who configures that: workspace admin or platform admin?
6. **Issue #45.** Close as resolved (scorecards shipped) and open a separate, smaller issue for cost visibility if still wanted.
