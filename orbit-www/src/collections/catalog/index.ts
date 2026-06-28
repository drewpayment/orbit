export { CatalogEntities } from './CatalogEntities'
export { CatalogRelations } from './CatalogRelations'
// Vocabularies come from the framework-light constants module. Client-reachable
// code should import these from '@/collections/catalog/constants' directly to
// avoid pulling the collection configs (and their server-only hooks) into the
// browser bundle; this barrel re-export is for server-side convenience.
export { ENTITY_KINDS, RELATION_TYPES } from './constants'
