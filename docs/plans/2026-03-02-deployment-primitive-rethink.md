# Deployment Primitive Rethink — Future Work

**Status:** Parking lot / future work
**Date:** 2026-03-02
**Context:** Identified during Launches feature brainstorming

## Problem

The current "Deployment" primitive tries to be two things:
1. Config file generation (docker-compose, helm, terraform templates)
2. Execution of those configs (only docker-compose supported)

This creates confusion with the new **Launches** primitive, which handles live cloud infrastructure provisioning via Pulumi.

## Current State of Deployments

- Tied to an App (required relationship)
- Uses "Deployment Generators" to template config files
- Two modes: "generate" (preview files) and "execute" (run docker-compose)
- Status: pending → deploying → generated → deployed → failed
- Feature feels rough/unfinished — only docker-compose execution works
- Collections: `Deployments`, `DeploymentGenerators`
- Workflow: `deployment_workflow.go`
- Server actions: `orbit-www/src/app/actions/deployments.ts`

## Proposed Direction

**Option 3 (selected during brainstorming): Rename and refine Deployments to have a clearer, narrower scope.**

The distinction should be:
- **Launch** = infrastructure primitive (provisions cloud resources: VPCs, databases, clusters, etc.)
- **Deployment** (or renamed primitive) = application release primitive (pushes app code/containers onto existing infrastructure)

Two distinct steps: "Launch the infra, then Deploy the app to it."

## Open Questions (for future brainstorming session)

- What should Deployments be renamed to? (e.g., "Releases", "Rollouts", "Pushes")
- Should the existing generator system stay as-is, be folded into Launches, or be reworked?
- How does a Deployment reference the Launch it targets?
- What happens to the existing terraform/helm generators — do they become Launch Templates instead?
- Should the current Deployment collections/workflows be deprecated or evolved?

## Action Items

- [ ] Brainstorm the Deployment rename/refine in a separate session
- [ ] Determine migration path for existing Deployment data model
- [ ] Update the existing deployment UI/workflows once the new scope is defined
