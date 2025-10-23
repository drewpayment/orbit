import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Core services - minimal set for plugin execution
backend.add(import('@backstage/plugin-app-backend/alpha'));

// Authentication - guest provider for MVP (Orbit handles actual auth)
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));

// Software Catalog - Core Backstage functionality
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-github'));

// Scaffolder - Template system for creating new components
backend.add(import('@backstage/plugin-scaffolder-backend'));

// Custom workspace isolation middleware
backend.add(import('./modules/workspace-isolation'));

// Initial plugin set - CI/CD category
backend.add(import('@backstage-community/plugin-github-actions-backend'));

// Initial plugin set - Infrastructure/Deployment category
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));

// Note: Additional plugins can be added as needed:
// - Azure DevOps: @backstage-community/plugin-azure-devops-backend
// - Azure Resources: @vippsas/plugin-azure-resources-backend
// - Kubernetes: @backstage/plugin-kubernetes-backend
// - Jenkins: @backstage/plugin-jenkins-backend
// - PagerDuty: @backstage/plugin-pagerduty-backend

backend.start();
