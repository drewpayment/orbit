# MeiliSearch Integration for Knowledge Spaces

**Date:** 2025-11-21
**Status:** Approved Design
**Context:** Replace PostgreSQL FTS approach with MeiliSearch for knowledge spaces search

## Design Decisions

### Deployment
- **Approach:** Docker Compose service for both local dev and self-hosted production
- **Rationale:** Full control, no external costs, easy local development

### Data Synchronization
- **Approach:** Real-time via Payload hooks → Temporal workflows → MeiliSearch
- **Operations:** All create/update/delete operations go through Temporal
- **Trade-off:** 1-2 second eventual consistency acceptable for resilience and audit trail

### Search Scope
- **Approach:** Workspace-scoped search (search across all spaces in workspace)
- **Rationale:** Simpler UX, broader results, users find content across all accessible spaces

### Access Control
- **Approach:** Filter at query time with workspaceId
- **Implementation:** Double-layer security (Payload access check + MeiliSearch filter)

### Indexed Fields
- **Title:** Searchable, displayed, rank weight 10 (highest)
- **Content:** Searchable with snippets, rank weight 5
- **Tags:** Searchable array, displayed as chips, rank weight 7
- **Author:** Not included (design decision from brainstorming)

---

## Architecture

### Infrastructure

**Docker Compose Service:**
```yaml
meilisearch:
  container_name: orbit-meilisearch
  image: getmeili/meilisearch:v1.5
  ports:
    - 7700:7700
  environment:
    - MEILI_MASTER_KEY=${MEILISEARCH_MASTER_KEY}
    - MEILI_ENV=development
  volumes:
    - meilisearch-data:/meili_data
  restart: unless-stopped
```

**Index Schema:**
```typescript
{
  // Primary key
  id: string              // Payload document ID

  // Access control
  workspaceId: string     // Filterable, for security

  // Metadata
  spaceId: string         // Filterable
  spaceName: string       // Displayed in results
  slug: string            // For URL construction

  // Searchable content
  title: string           // Rank weight: 10
  content: string         // Rank weight: 5 (plain text from blocks)
  tags: string[]          // Rank weight: 7

  // Timestamps
  updatedAt: string       // Sortable, ISO 8601 format
}
```

**MeiliSearch Configuration:**
- Ranking rules: `["words", "typo", "proximity", "attribute", "sort", "exactness"]`
- Searchable attributes: `["title", "tags", "content"]` (in ranking order)
- Filterable attributes: `["workspaceId", "spaceId"]`
- Sortable attributes: `["updatedAt"]`
- Typo tolerance: enabled
- Pagination: 20 results per page
- Highlight tags: `<mark>` (styled in frontend CSS)

---

## Data Flow

### Overview
```
KnowledgePage Change (Payload)
  ↓
afterChange Hook
  ↓
Start Temporal Workflow (non-blocking)
  ↓
Workflow Activities:
  1. FetchPageDataActivity
  2. TransformToSearchDocumentActivity
  3. SyncToMeiliSearchActivity
  ↓
MeiliSearch Index Updated
```

### Payload Hook Integration

**File:** `orbit-www/src/collections/hooks/syncToSearch.ts`

```typescript
import { CollectionAfterChangeHook } from 'payload'
import { getTemporalClient } from '@/lib/temporal'

export const syncToSearch: CollectionAfterChangeHook = async ({
  doc,
  req,
  operation,
  previousDoc,
}) => {
  const { payload } = req

  // Get workspace ID from knowledge space relationship
  const space = typeof doc.knowledgeSpace === 'object'
    ? doc.knowledgeSpace
    : await payload.findByID({
        collection: 'knowledge-spaces',
        id: doc.knowledgeSpace,
      })

  const workspaceId = typeof space.workspace === 'string'
    ? space.workspace
    : space.workspace.id

  // Start Temporal workflow (non-blocking)
  const temporal = await getTemporalClient()

  await temporal.workflow.start('syncPageToSearch', {
    taskQueue: 'search-indexing',
    workflowId: `sync-page-${doc.id}-${Date.now()}`,
    args: [{
      pageId: doc.id,
      operation: operation === 'delete' ? 'delete' : 'index',
      workspaceId,
    }],
  })

  // Return immediately (don't wait for workflow)
  return doc
}
```

### Temporal Workflow

**File:** `temporal-workflows/internal/search/SyncPageToSearchWorkflow.go`

**Workflow Definition:**
```go
func SyncPageToSearch(ctx workflow.Context, input SyncPageInput) error {
  ao := workflow.ActivityOptions{
    StartToCloseTimeout: 30 * time.Second,
    RetryPolicy: &temporal.RetryPolicy{
      MaximumAttempts: 3,
      InitialInterval: 1 * time.Second,
      BackoffCoefficient: 2.0,
    },
  }
  ctx = workflow.WithActivityOptions(ctx, ao)

  if input.Operation == "delete" {
    // Delete from MeiliSearch
    return workflow.ExecuteActivity(ctx, DeleteFromMeiliSearch, input.PageID).Get(ctx, nil)
  }

  // Fetch page data
  var pageData PageData
  err := workflow.ExecuteActivity(ctx, FetchPageData, input.PageID).Get(ctx, &pageData)
  if err != nil {
    return err
  }

  // Transform to search document
  var searchDoc SearchDocument
  err = workflow.ExecuteActivity(ctx, TransformToSearchDocument, pageData).Get(ctx, &searchDoc)
  if err != nil {
    return err
  }

  // Sync to MeiliSearch
  return workflow.ExecuteActivity(ctx, SyncToMeiliSearch, searchDoc).Get(ctx, nil)
}
```

**Activities:**

1. **FetchPageDataActivity**
   - Calls Payload REST API to get full page document
   - Depth: 2 (includes space and workspace relationships)
   - Returns: Complete page data with relationships

2. **TransformToSearchDocumentActivity**
   - Extracts plain text from block JSON content
   - Recursively traverses block nodes, concatenates text nodes
   - Builds search document matching index schema
   - Returns: MeiliSearch document ready for indexing

3. **SyncToMeiliSearchActivity**
   - Calls MeiliSearch SDK `addDocuments()` or `updateDocuments()`
   - Uses upsert semantics (create or update)
   - Returns: Task ID from MeiliSearch

4. **DeleteFromMeiliSearchActivity**
   - Calls MeiliSearch SDK `deleteDocument()`
   - Returns: Task ID from MeiliSearch

**Error Handling:**
- Each activity retries 3 times with exponential backoff
- Workflow failures logged to Temporal history
- Failed workflows can be retried via Temporal UI
- If MeiliSearch is down, workflows automatically retry

---

## Search API

### API Route

**File:** `orbit-www/src/app/api/workspaces/[slug]/knowledge/search/route.ts`

**Implementation:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { getMeiliSearchClient } from '@/lib/meilisearch'
import configPromise from '@/payload.config'

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const payload = await getPayload({ config: configPromise })
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')

    if (!query) {
      return NextResponse.json({ results: [], total: 0 })
    }

    // Get workspace
    const workspaces = await payload.find({
      collection: 'workspaces',
      where: { slug: { equals: params.slug } },
      limit: 1,
    })

    if (!workspaces.docs.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const workspace = workspaces.docs[0]

    // Search MeiliSearch
    const meili = getMeiliSearchClient()
    const index = meili.index('knowledge-pages')

    const results = await index.search(query, {
      filter: `workspaceId = ${workspace.id}`,
      attributesToRetrieve: ['*'],
      attributesToHighlight: ['title', 'content'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      limit: 20,
    })

    // Enrich results with URLs and breadcrumbs
    const enriched = results.hits.map(hit => ({
      id: hit.id,
      title: hit._formatted?.title || hit.title,
      snippet: hit._formatted?.content || '',
      breadcrumb: `${hit.spaceName} > ${hit.title}`,
      url: `/workspaces/${params.slug}/knowledge/${hit.spaceSlug}/${hit.slug}`,
      tags: hit.tags || [],
      updatedAt: hit.updatedAt,
    }))

    return NextResponse.json({
      results: enriched,
      total: results.estimatedTotalHits,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    )
  }
}
```

**MeiliSearch Client Setup:**

**File:** `orbit-www/src/lib/meilisearch.ts`

```typescript
import { MeiliSearch } from 'meilisearch'

let client: MeiliSearch | null = null

export function getMeiliSearchClient(): MeiliSearch {
  if (!client) {
    client = new MeiliSearch({
      host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
      apiKey: process.env.MEILISEARCH_MASTER_KEY || '',
    })
  }
  return client
}
```

---

## Frontend Integration

### Search Modal Component

**File:** `orbit-www/src/components/features/knowledge/SearchModal.tsx`

**Features:**
- Headless UI Dialog component
- Debounced search (300ms)
- Keyboard navigation (arrow keys, enter, escape)
- Highlight matching terms with `<mark>` tags
- Loading states and empty states

**Keyboard Shortcut:**
- Cmd+K (Mac) or Ctrl+K (Windows/Linux)
- Global listener mounted in root layout

**Search UX:**
- As-you-type search with live results
- Results show: title (bold), breadcrumb (gray), snippet (with highlights)
- Click result navigates to page and closes modal
- Target performance: <200ms from keypress to results

**Component Structure:**
```
SearchModalClient (handles keyboard listener)
  └─ SearchModal (manages state, API calls)
      └─ SearchResults (renders result list)
          └─ SearchResult (individual result item)
```

---

## Implementation Tasks

### Phase 1: Infrastructure Setup
1. Add MeiliSearch to docker-compose.yml
2. Add environment variables (MEILISEARCH_HOST, MEILISEARCH_MASTER_KEY)
3. Install meilisearch SDK: `bun add meilisearch`
4. Create MeiliSearch client singleton
5. Create index initialization script

### Phase 2: Temporal Workflows
1. Create SyncPageToSearchWorkflow in Go
2. Implement FetchPageDataActivity
3. Implement TransformToSearchDocumentActivity (block JSON → plain text)
4. Implement SyncToMeiliSearchActivity
5. Implement DeleteFromMeiliSearchActivity
6. Register workflow and activities with worker
7. Add integration tests

### Phase 3: Payload Integration
1. Create syncToSearch hook
2. Add hook to KnowledgePages collection
3. Handle create/update/delete operations
4. Add error logging

### Phase 4: Search API
1. Create search API route
2. Implement workspace-scoped search
3. Add result enrichment (breadcrumbs, URLs)
4. Add error handling

### Phase 5: Frontend
1. Create SearchModal component
2. Add keyboard shortcut listener
3. Implement debounced search
4. Add keyboard navigation
5. Style results with highlighting
6. Mount in root layout

### Phase 6: Testing & Documentation
1. Test search indexing via Temporal UI
2. Test search API with various queries
3. Test frontend search modal
4. Write user documentation
5. Add bulk re-indexing script for existing pages

---

## Success Criteria

- ✅ MeiliSearch service running in Docker
- ✅ Pages automatically indexed on create/update/delete
- ✅ Search returns results in <200ms
- ✅ Workspace-scoped access control enforced
- ✅ Keyboard shortcut (Cmd+K) opens search modal
- ✅ Search highlights matching terms
- ✅ Failed indexing operations retry automatically
- ✅ All tests passing

---

## Future Enhancements (Out of Scope)

- Faceted search by tags or space
- Advanced search syntax (AND, OR, NOT operators)
- Search analytics and popular queries
- AI-powered semantic search
- Search result personalization based on user activity
