# PoC Directory

This directory contains proof-of-concept experiments and research projects.

## Completed PoCs

### Phase 0: Backstage Plugin Integration (2025-10-19)

**Status:** ✅ COMPLETE - Research findings archived

**Location:** Removed after research completion (was 2.5 GB with node_modules)

**Findings:** Archived in `.agent/research/phase-0-backstage-poc/`

**Key Documents:**
- `.agent/research/phase-0-backstage-poc/FINDINGS.md` - Complete research report
- `.agent/research/phase-0-backstage-poc/research-output/` - Detailed analyses

**Decision:** ✅ PROCEED TO PHASE 1 with multi-instance architecture

**To Recreate PoC:**
```bash
cd poc
npx @backstage/create-app@latest --path backstage-test
cd backstage-test
yarn install
yarn workspace backend add @roadiehq/backstage-plugin-argo-cd-backend
yarn workspace backend start
```

---

## Active PoCs

(None currently)

---

## Instructions

- Use this directory for temporary proof-of-concept work
- Archive findings in `.agent/research/` when complete
- Clean up large installations (node_modules, etc.) after research
- Document recreate steps in this README
