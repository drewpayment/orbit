# Knowledge Spaces Redesign - Design Document

**Date:** 2025-11-20
**Status:** Design Approved
**Owner:** Drew Payment

## Overview

This document outlines the redesign of Orbit's knowledge spaces feature to provide a more immersive, user-friendly documentation experience inspired by modern tools like Notion, Coda, and AFFiNE.

### Goals

1. **Better content creation:** Block-based editor with rich media, code blocks, tables, and interactive elements
2. **Improved navigation and discovery:** Instant search and wiki-style page linking with backlinks
3. **Seamless editing experience:** Notion-style inline editing without separate edit modes
4. **Maintain compatibility:** Preserve Payload CMS authoring experience for admin users

### Key Constraints

- Minimize new infrastructure dependencies
- Use Postgres FTS initially (defer MeiliSearch to phase 2)
- Must not break Payload admin editing experience
- Simplified migration (only one test document exists currently)

## Architecture

### High-Level Design

**Dual-Editor Strategy:**
- **Frontend:** Novel block editor for inline editing (built on Tiptap/ProseMirror)
- **Backend:** Payload Lexical editor remains for admin power users
- **Storage:** Unified block JSON format for both editors
- **Search:** PostgreSQL full-text search with GIN indexes (upgrade path to MeiliSearch later)
- **Link Graph:** New PageLinks collection tracks page references for backlinks

### Data Flow

```
User edits in Novel
  → Block JSON sent to API
  → Payload validates and stores
  → Search index updated (Postgres)
  → Link graph updated (PageLinks)

Admin edits in Payload Lexical
  → Custom hook converts to block JSON
  → Same storage path
```

### Technology Decisions

**Novel vs BlockNote:**
- Chose Novel for its headless/flexible architecture
- Better fit with existing Tailwind design system
- Lighter weight, aligns with "minimize dependencies"
- Template-based approach allows full customization
- Purpose-built for Notion-style inline editing

**Postgres FTS vs MeiliSearch:**
- Start with Postgres FTS (no new infrastructure)
- Good enough for initial launch
- Clear upgrade path to MeiliSearch when needed
- Same API contract, swap implementation

## Frontend Editing Experience

### Inline Editing Flow

- Click anywhere on page to enter edit mode (no separate route)
- Novel editor replaces static content view with identical visual layout
- Auto-save debounces changes every 2 seconds or on blur
- Exit via clicking outside content or pressing Escape

### Block Interactions

**Slash Commands:**
- `/heading`, `/code`, `/callout`, `/table` trigger block menu
- Dropdown shows all available block types with descriptions

**@ Mentions:**
- Type `@` to link pages
- Dropdown shows fuzzy-matched pages from current space
- Creates wiki-style links with pageId references

**Block Management:**
- Drag handles on hover for reordering
- Block actions menu (delete, duplicate, turn into)
- Markdown shortcuts: `#` for heading, `-` for list, ``` for code

### Custom Block Types

**Rich Media:**
- **Images:** Upload to Payload Media, inline with captions, click to expand
- **Videos:** YouTube/Vimeo embeds, privacy-enhanced mode
- **Embeds:** Allowlist for Figma, Miro, CodeSandbox, Loom
- **File attachments:** Links to Media collection with download

**Code & Technical:**
- **Code blocks:** Shiki syntax highlighting (100+ languages), line numbers, copy button
- **Inline code:** Monospace with subtle background
- **API docs blocks:** Method badges, endpoint, parameters, response examples

**Interactive:**
- **Callouts:** Info/warning/success/error variants with icons
- **Toggles:** Collapsible sections, state persisted in localStorage
- **Tabs:** Tabbed content for related sections
- **Progress indicators:** Visual bars for status tracking

**Tables:**
- Simple markdown-style tables
- Column sorting on header click
- Basic alignment support
- No database features (keep it simple)

### Permissions & Conflicts

- Read-only mode for users without edit permissions (workspace roles)
- Optimistic UI updates with rollback on save failure
- Last-write-wins with version number conflict detection
- No real-time collaboration initially

## Backend/Data Layer

### Block JSON Format

Novel uses Tiptap's JSON schema:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": {"level": 1},
      "content": [{"type": "text", "text": "Title"}]
    },
    {
      "type": "paragraph",
      "content": [...]
    },
    {
      "type": "codeBlock",
      "attrs": {"language": "typescript"},
      "content": [...]
    }
  ]
}
```

### Storage Strategy

- KnowledgePage `content` field stores block JSON (already JSON type)
- Both Novel and Lexical serialize to shared format
- Custom Payload field component wraps Lexical, converts on save/load
- Add `contentFormat` field to track which editor last saved

### Serialization Layer

Location: `orbit-www/src/lib/serializers/`

- **Lexical → Block JSON:** Transform Lexical nodes to Tiptap blocks
- **Block JSON → Lexical:** Reverse transformer for admin editing
- **Block JSON → React:** Enhanced serializer with new block types for display

### Database Changes

**Schema updates:**
```sql
-- Add content format tracking
ALTER TABLE knowledge_pages ADD COLUMN content_format VARCHAR(20) DEFAULT 'blocks';

-- Add plain text extraction for search
ALTER TABLE knowledge_pages ADD COLUMN content_text TEXT GENERATED ALWAYS AS (
  -- Extract text from block JSON
) STORED;

-- Full-text search index
CREATE INDEX knowledge_pages_search_idx
  ON knowledge_pages
  USING GIN(to_tsvector('english', title || ' ' || content_text));
```

### API Endpoints

- `PATCH /api/knowledge-pages/:id` - Save blocks from Novel editor
- `GET /api/knowledge-pages/:id/edit` - Returns block JSON for editing
- Existing endpoints remain backward compatible

### Migration Plan (Simplified)

Since only one test document exists:

1. Deploy new system with block JSON format
2. Manually recreate the test document (5 minutes)
3. Remove Lexical serializer immediately
4. All new content uses block JSON from day one

No elaborate rollback needed - can easily recreate single test document.

## Search Implementation

### Database Setup

```sql
-- Generated column for searchable text
ALTER TABLE knowledge_pages
  ADD COLUMN content_text TEXT
  GENERATED ALWAYS AS (extract_text_from_blocks(content)) STORED;

-- GIN index for full-text search
CREATE INDEX knowledge_pages_search_idx
  ON knowledge_pages
  USING GIN(to_tsvector('english', title || ' ' || content_text));
```

### Search API

**Endpoint:** `GET /api/workspaces/[slug]/knowledge/search`

**Query parameters:**
- `q`: Search query string
- `scope`: `space` (current space) or `workspace` (all spaces)

**Response:**
```json
{
  "results": [
    {
      "id": "123",
      "title": "Page Title",
      "breadcrumb": "Space > Parent > Page",
      "snippet": "...matched <mark>text</mark>...",
      "lastUpdated": "2025-11-20T10:00:00Z",
      "rank": 0.8
    }
  ]
}
```

**Implementation:**
- Uses `ts_rank()` for relevance scoring
- Title matches ranked higher than content matches
- Recent pages boosted in ranking
- Published pages ranked above drafts

### Frontend Search UI

**Keyboard Shortcut:** Cmd+K / Ctrl+K opens search modal

**Search Modal:**
- Floating dialog with input field
- Instant results below (debounced 300ms)
- Shows top 10 matches
- Keyboard navigation: arrows to navigate, Enter to open, Escape to close

**Result Display:**
- Page title (bold)
- Breadcrumb path (muted)
- Matched snippet with `<mark>` highlights
- Empty state: "No results found"

**Recent Searches:**
- LocalStorage tracks last 5 searches
- Quick access to previous queries

**Performance:**
- GIN indexes make searches fast (<100ms)
- Debouncing prevents excessive API calls
- Results cached client-side for 5 minutes

## Page Linking and Backlinks

### Wiki-Style Page Links

**@ Mentions in Editor:**
- Type `@` triggers page dropdown
- Fuzzy search filters as you type
- Shows pages from current space

**Link Format:**
```json
{
  "type": "mention",
  "attrs": {
    "pageId": "123",
    "label": "Page Title"
  }
}
```

**Link Rendering:**
- Displays as styled link
- Navigates to page on click
- Broken link warning if page deleted/archived

### Link Graph Storage

**New Collection:** `PageLinks`

**Schema:**
```typescript
{
  id: string
  fromPage: KnowledgePage (relationship)
  toPage: KnowledgePage (relationship)
  linkType: 'mention' | 'embed' | 'reference'
  createdAt: timestamp
}
```

**Population:**
- Payload `afterChange` hook on KnowledgePages
- Parses block JSON for mentions/links
- Creates/updates PageLinks records

### Backlinks Panel

**Location:** Right sidebar on page view (collapsible)

**Display:**
- List of pages linking to current page
- Grouped by space if cross-space links exist
- Snippet of content surrounding the link
- Count badge in panel header

**Empty State:**
- "No pages link here yet"
- Suggestion to reference from other pages

### Link Validation

- On save, validate all `@pageId` references exist
- Check user has permission to view linked pages
- Warn (don't block) if linking to draft/archived pages
- Admin sees link graph in Payload custom field

### Search Integration

- Linked pages appear in search results
- "Related pages" section uses backlinks for suggestions

## Content Block Types

### Rich Media Blocks

**Images:**
- Upload via Novel's image block
- Stored in Payload Media collection
- Lazy loading with caption support
- Click to expand fullscreen

**Videos:**
- YouTube/Vimeo embeds via URL paste
- Iframe with privacy-enhanced mode
- Thumbnail until user clicks play

**Embeds:**
- Allowlist: Figma, Miro, CodeSandbox, Loom
- Responsive aspect ratio container
- Iframe with security restrictions

**File Attachments:**
- Link to Media collection files
- File type icon and size display
- Download button

### Code & Technical Content

**Code Blocks:**
- Syntax highlighting via Shiki
- Supports 100+ languages
- Language selector dropdown
- Optional line numbers
- Copy-to-clipboard button

**Inline Code:**
- Monospace font
- Subtle background color
- Format: `inline code`

**API Documentation Blocks:**
- Method badge (GET/POST/PUT/DELETE)
- Endpoint display
- Parameters table
- Response example (collapsible)

**Mermaid Diagrams:**
- Future enhancement
- Render flowcharts/diagrams from syntax

### Interactive Blocks

**Callouts:**
- Four variants: info, warning, success, error
- Custom background colors
- Icon on left side
- Optional dismissible feature

**Toggles:**
- Collapsible sections
- Chevron icon indicates state
- Remembers expanded state in localStorage
- Useful for FAQs and long sections

**Tabs:**
- Tabbed content blocks
- Show multiple related sections
- Example: different code language snippets

**Progress Indicators:**
- Visual progress bars
- Track implementation status
- Example: "Implementation: 60% complete"

### Tables

**Features:**
- Simple markdown-style tables
- Header row with styling
- Column sorting (ascending/descending)
- Basic alignment (left/center/right)

**Non-Features:**
- No database functionality
- No filtering/queries
- Keep it simple vs Notion/Coda complexity

### Block Configuration

**Settings Panel:**
- Click block to see floating toolbar
- Common settings:
  - Alignment (left/center/right)
  - Width (normal/wide/full)
  - Background color (select blocks)
- Settings stored in block's `attrs` object

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Infrastructure:**
- Add Novel dependencies to package.json
- Set up block JSON serializers
- Create Postgres FTS indexes
- Add PageLinks collection

**Testing:**
- Unit tests for serializers
- Integration tests for API endpoints
- Manual QA of block rendering

### Phase 2: Editor Integration (Week 2)

**Frontend:**
- Implement Novel editor component
- Add slash commands and @ mentions
- Build custom block renderers
- Create inline editing flow

**Backend:**
- API endpoints for saving/loading blocks
- Link graph population via hooks
- Search API implementation

**Testing:**
- Novel editor functionality tests
- API integration tests
- Search relevance testing

### Phase 3: Advanced Features (Week 3)

**Rich Content:**
- Implement all custom block types
- Image upload integration
- Embed allowlist validation
- Code syntax highlighting

**Navigation:**
- Search modal UI
- Keyboard shortcuts
- Backlinks panel
- Link validation

**Testing:**
- Block functionality tests
- Search UI tests
- Link graph accuracy tests

### Phase 4: Polish & Launch (Week 4)

**UX Refinement:**
- Performance optimization
- Error handling and edge cases
- Loading states and animations
- Mobile responsiveness

**Documentation:**
- User guide for new features
- Admin documentation
- Migration notes

**Launch:**
- Deploy to production
- Monitor for issues
- Gather user feedback

## Future Enhancements (Phase 2)

### MeiliSearch Upgrade

When search becomes a bottleneck:
- Add MeiliSearch container to docker-compose
- Implement indexing service
- Swap Postgres FTS for MeiliSearch API
- Maintain same API contract

**Benefits:**
- Faster search (<50ms)
- Better relevance ranking
- Typo tolerance
- Faceted search

### Real-Time Collaboration

- WebSocket connection for live updates
- Operational transform or CRDT for conflict resolution
- Show active users on page
- Cursor presence indicators

### Version History

- Track content snapshots on save
- Diff viewer for comparing versions
- Restore previous versions
- Blame view showing who changed what

### Comments & Discussions

- Inline comments on blocks
- Discussion threads
- @ mentions in comments
- Notifications for mentions/replies

### Advanced Search

- Filters: by space, author, date range, tags
- Sort options: relevance, date, title
- Saved searches
- Search suggestions

### Mobile Apps

- Native iOS/Android apps
- Offline-first with sync
- Mobile-optimized editor
- Push notifications

## Success Metrics

### User Engagement

- **Page creation rate:** Number of new pages per week
- **Edit frequency:** Average edits per page
- **Search usage:** Search queries per user session
- **Link density:** Average backlinks per page

### Performance

- **Search speed:** P95 < 200ms for Postgres FTS
- **Editor load time:** < 500ms to interactive
- **Save latency:** < 1s for auto-save
- **Page render:** < 100ms for content serialization

### Quality

- **Link accuracy:** % of valid (non-broken) links
- **Search relevance:** User clicks on top 3 results
- **Content richness:** % pages using custom blocks
- **User satisfaction:** NPS score for knowledge feature

## Risks & Mitigations

### Risk: Novel Editor Compatibility

**Impact:** Block JSON format doesn't round-trip correctly with Payload Lexical

**Mitigation:**
- Comprehensive serializer tests
- Content validation on save
- Keep legacy format as backup during migration
- Test with diverse content types

### Risk: Search Performance Degradation

**Impact:** Postgres FTS too slow with large content volume

**Mitigation:**
- Monitor search latency metrics
- Pre-planned MeiliSearch upgrade path
- Optimize GIN indexes
- Add search result caching

### Risk: Link Graph Complexity

**Impact:** Backlinks calculation becomes expensive at scale

**Mitigation:**
- Incremental updates via hooks (not full recalculation)
- Index on fromPage and toPage
- Cache backlinks count
- Pagination for pages with many backlinks

### Risk: Inline Editing Conflicts

**Impact:** Users lose work due to concurrent edits

**Mitigation:**
- Version number conflict detection
- Optimistic UI with rollback
- Warning message on conflict
- Future: add real-time collaboration

## Conclusion

This redesign transforms Orbit's knowledge spaces into a modern, immersive documentation platform. By adopting Novel's block-based editor, implementing intelligent search, and adding wiki-style linking, we provide a user experience on par with industry-leading tools like Notion while maintaining our commitment to simplicity and performance.

The phased implementation approach allows us to deliver value incrementally while managing risk. Starting with Postgres FTS keeps infrastructure simple, with a clear upgrade path to MeiliSearch when needed. The dual-editor strategy preserves the Payload admin experience while unlocking powerful inline editing for end users.

With only one test document to migrate, we can move quickly without elaborate migration tooling. The architecture is designed for future enhancements like real-time collaboration and version history, ensuring the platform can grow with user needs.
