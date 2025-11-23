# Editorial Page Editor Design

**Date**: 2025-11-23
**Status**: Design Complete, Ready for Implementation
**Owner**: Editorial Experience Team

## Overview

This document describes the redesign of the knowledge page editor experience to create a more intuitive, integrated, and editorial-focused interface. The current implementation uses a traditional documentation layout with click-to-edit functionality. The new design transforms the experience into a seamless, always-on editor with a premium editorial aesthetic while maintaining full consistency with the Orbit design system.

## Problem Statement

The current page editor has several friction points:
- **Too much chrome and UI clutter** - cards, borders, padding create visual noise
- **Layout feels cramped and restrictive** - multiple containers limit breathing room
- **Generic and uninspired design** - follows predictable documentation patterns
- **Navigation feels disconnected** - sidebar and breadcrumbs feel separate from content
- **Mode switching is jarring** - clicking to enter edit mode breaks flow

## Goals

1. **Reduce visual clutter** - remove unnecessary containers, borders, and chrome
2. **Create breathing room** - generous whitespace and full-width canvas
3. **Seamless editing** - always-on editing like Notion, no mode switching
4. **Editorial aesthetic** - beautiful typography and print-inspired layout
5. **Integrated navigation** - auto-hide sidebar that feels connected to content
6. **Maintain consistency** - enhance the editor while staying true to Orbit's design system

## Design Principles

- **Content is king** - everything else fades into the background
- **Editorial quality** - treat content creation as a premium experience
- **Consistent integration** - enhance the editor without creating a separate visual language
- **Progressive disclosure** - show UI elements only when needed
- **Graceful motion** - subtle animations that enhance without distracting

## Design Details

### 1. Overall Layout & Structure

The page becomes a single, expansive canvas that stretches edge-to-edge:

**Structure:**
- **No visible containers or cards** - all box outlines and borders removed
- **Single content area** with generous padding:
  - Desktop: 8-12rem horizontal padding
  - Mobile: 3-4rem horizontal padding
- **Slim fixed header** (40px height) at top:
  - Breadcrumbs (left side)
  - Auto-save status indicator (right side)
  - Share button (if needed)
- **Auto-hide sidebar** (280px wide):
  - Completely hidden by default
  - Slides in from left on hover or click
  - Appears as overlay with backdrop blur
  - Does not push content when shown
- **Vertical rhythm** using consistent spacing scale:
  - Title to metadata: 2rem
  - Metadata to content: 3rem
  - Between content sections: 1.5-2rem

**Key principle**: Remove all visual boundaries. Content floats on a clean surface.

### 2. Typography & Visual Hierarchy

**Font System:**

**Editor Content (Editorial Serif):**
- **Title block**: Crimson Pro or Lora
  - Size: 3.5rem (56px) on desktop
  - Weight: 700 (bold)
  - Line height: 1.2
- **Body content**: Charter or Source Serif Pro
  - Size: 1.125rem (18px)
  - Weight: 400 (regular)
  - Line height: 1.7
  - Optimal for reading comfort
- **Headings within content**:
  - H2: 2rem, weight 600
  - H3: 1.5rem, weight 600
  - Same serif family

**UI Elements (Existing System Font):**
- **Breadcrumbs, labels, buttons**: Geist Sans (existing)
  - Size: 0.875rem (14px)
  - Maintains app-wide consistency
- **Metadata line**: Geist Sans
  - Size: 0.875rem
  - Color: text-muted-foreground
  - Weight: 500

**Hierarchy:**
- Page title dominates (largest, boldest)
- Metadata whispers (small, muted)
- Content reads comfortably (optimized size and line-height)
- Headings create clear structure

**Implementation:**
- Add `@font-face` declarations for serif fonts
- Use `font-display: swap` to prevent layout shift
- Scope serif fonts to `.page-editor` class
- All UI chrome keeps Geist Sans

### 3. Sidebar Navigation

**Trigger & Animation:**

**Default State:**
- Completely hidden (off-screen, translateX(-100%))
- No persistent visual elements

**Hover Zone:**
- First 20px of left edge acts as trigger
- Hovering shows subtle vertical indicator line:
  - Width: 2px
  - Color: primary (orange/amber)
  - Opacity: 0.5
  - Transition: 150ms ease

**Slide-in Animation:**
- Trigger: Hover over left edge or click hamburger icon
- Sidebar slides in: 250ms ease-out transition
- Backdrop overlay appears: 200ms fade-in
  - Color: rgba(0,0,0,0.4)
  - Backdrop blur: 8px (for depth)
- Sidebar width: 280px fixed

**Slide-out:**
- Trigger: Click outside sidebar or move mouse away (300ms delay)
- Reverse animations
- Keyboard shortcut: Cmd+\\ (Ctrl+\\ on Windows/Linux)

**Sidebar Content & Styling:**
- **Background**: Use existing `bg-background` token (solid, not translucent)
- **Padding**: 1.5rem all around
- **Header**: Space icon + name (existing SpaceNavigator component)
- **Page tree**: Hierarchical list with indent levels
- **Current page highlight**: Subtle background + left border accent (primary color)
- **Typography**: Geist Sans, 0.9rem
- **Remove Card wrapper** - no border, no shadow, clean content only

### 4. Content Editing Experience

**Always-On Editing:**
- **No edit mode toggle** - entire page is always editable (for authorized users)
- **Click anywhere** in content to focus and start typing
- **Title is first block** - clicking focuses it for editing like any other block
- **Empty state**: When page is empty, show centered prompt:
  - Text: "Start writing..."
  - Color: muted
  - Disappears on first click

**Block Interactions:**

**Drag Handles:**
- Appear on hover over any block
- Position: Left side, -2rem from content edge
- Icon: Six dots (grip vertical)
- Drag to reorder blocks

**Slash Commands:**
- Type `/` to trigger Novel command menu
- Insert different block types (heading, list, image, etc.)

**Selection Toolbar:**
- Appears above selected text
- Floating, minimal design
- Actions: Bold, Italic, Link, etc.
- Position: Centered above selection

**Block Actions Menu:**
- Icon: ⋮ (three vertical dots)
- Position: Top-right of block on hover
- Actions: Delete, Duplicate, Turn into, etc.

**Visual Feedback:**

**Focused Block:**
- Left border: 3px solid, primary color
- Background: Very slight tint (bg-muted with 30% opacity)
- Transition: 200ms ease-out

**Hover State:**
- Drag handle appears
- Subtle background change (bg-muted with 20% opacity)
- Transition: 150ms ease

**Typing State:**
- No additional chrome
- Natural text flow with blinking cursor

**Auto-save Indicator:**
- **Position**: Top-right of fixed header
- **States**:
  1. "Saving..." with spinner icon
  2. "Saved" with checkmark icon
  3. "Offline" if disconnected (with warning icon)
- **Size**: 0.8rem, unobtrusive
- **Transitions**: 200ms cross-fade between states

### 5. Metadata & Supplementary Content

**Metadata Line (Below Title):**

**Position**: Directly under title, 2rem gap

**Format**:
```
By [Author Name] · Updated [Month Day, Year] · [Status Badge]
```

**Styling:**
- Font: Geist Sans, 0.875rem
- Color: text-muted-foreground
- Weight: 500
- Single line, inline elements

**Status Badge** (if draft/archived):
- Inline badge with colored background
- Draft: `bg-secondary` with darker text
- Archived: `bg-muted` with darker text
- Size: 0.75rem text
- Border radius: rounded-full
- Padding: 0.25rem 0.625rem

**Future Enhancement:**
- Hover on author name shows avatar tooltip

**Tags Section:**

**Position**: After main content, before child pages, 4rem top margin

**Layout:**
```
Tagged with
[Tag 1] [Tag 2] [Tag 3]
```

**Styling:**
- Label: Geist Sans, 0.875rem, muted color
- Tags: Inline pills
  - Background: bg-secondary
  - Border radius: rounded-full
  - Text: 0.8rem
  - Padding: 0.5rem 1rem
  - Hover: Slightly darker background
  - Clickable (for future filtering)

**Child Pages Section:**

**Position**: At bottom, 4rem top margin

**Layout:**
```
Pages within [Current Page Title]

• Page Title 1
• Page Title 2 (Draft)
• Page Title 3
```

**Styling:**
- Heading: Serif font, 1.25rem, semibold
- List: Vertical stack, 1.5rem between items
- Links: Serif font, hover underline
- Status: Small text in muted color if draft
- **No boxes/borders** - clean text list only

**Key Principle**: Metadata supports content but never competes. Everything inline, nothing bolted on.

### 6. Motion & Interactions

**Page Load Animation (Staggered Reveal):**

Sequence:
1. Breadcrumb fades in (0ms delay, 400ms duration)
2. Title fades up and in (100ms delay, translateY(-20px) → 0, 400ms duration)
3. Metadata line fades in (200ms delay, 400ms duration)
4. Content blocks stagger in (each +50ms delay, max 5 blocks visible, then instant)

All animations: ease-out timing function

**Sidebar Transitions:**
- **Slide-in**: 250ms ease-out, translateX(-100% → 0)
- **Backdrop fade**: 200ms ease-in for dark overlay
- **Hover indicator**: 150ms ease for left edge line

**Block Interactions:**
- **Drag handle**: opacity 0 → 1, 150ms
- **Focused border**: width 0 → 3px, 200ms ease-out
- **Selection toolbar**: scale 0.95 → 1, 150ms

**Auto-save Indicator:**
- **State transitions**: 200ms cross-fade between icons
- **Success checkmark**: Tiny scale bounce (scale 0.9 → 1.1 → 1, 300ms)

**Scroll Behavior:**
- Smooth scroll when clicking navigation links
- Fixed header stays in place

**Philosophy**: Motion should feel **organic and purposeful**, not gratuitous. Prioritize CSS-only animations for performance.

### 7. Color & Theme Integration

**Design Philosophy:**
The editor should feel like a **premium content creation space** within the existing Orbit design system - not a different app.

**Color System (Use Existing Tokens):**
- All colors use existing CSS variables from globals.css
- **Background**: `bg-background` (oklch(1 0 0) in light, dark value in dark mode)
- **Text**: `text-foreground` for primary text
- **Muted text**: `text-muted-foreground` for metadata
- **Borders**: `border-border` (used sparingly)
- **Primary accent**: Existing orange/amber for focused states, links
  - Light: oklch(0.705 0.213 47.604)
  - Dark: oklch(0.646 0.222 41.116)
- **Status colors**: Use existing semantic tokens
  - Draft: `bg-secondary` with `text-secondary-foreground`
  - Archived: `bg-muted` with `text-muted-foreground`
  - Success: `text-green-600` for save indicator

**Typography Enhancement (Editor-Specific):**
- **App-wide UI**: Geist Sans (existing) - no changes
- **Editor content only**: Editorial serif fonts
  - Scoped to `.page-editor` or `.prose` classes
  - Applied only to title and body content blocks
  - Breadcrumbs, sidebar, metadata keep Geist Sans
- **Font loading**: Use `font-display: swap` to prevent FOUT

**Visual Weight:**
- Editor content: Serif treatment (distinctive, editorial)
- All UI chrome: Geist Sans (consistent with app)
- Creates hierarchy: **UI fades back, content stands out**

**Result**: The editor feels special and focused while remaining unmistakably part of Orbit. Like opening a premium document editor within your dashboard.

## Technical Considerations

### Component Updates Required

**1. PageEditor Component** (`orbit-www/src/components/features/knowledge/PageEditor.tsx`):
- Remove edit/read mode toggle logic
- Always render NovelEditor (with permission check)
- Remove click-to-edit handler
- Simplify to single mode

**2. Page Layout** (`orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`):
- Remove Card wrappers around content
- Remove Separator components
- Simplify layout structure
- Remove breadcrumb card styling
- Adjust padding and spacing

**3. Sidebar Component** (AppSidebar or create new KnowledgeSidebar):
- Implement auto-hide behavior
- Add hover zone detection
- Add slide-in/out animations
- Add backdrop overlay
- Add keyboard shortcut handler

**4. Typography Setup**:
- Add serif font imports to layout or global CSS
- Create scoped typography classes for editor content
- Apply serif fonts only within content blocks

### CSS/Styling Changes

**Global CSS Updates** (`globals.css`):
- Add `@font-face` declarations for Crimson Pro/Lora and Charter/Source Serif
- Define custom CSS variables for editor-specific spacing
- Add keyframes for staggered reveal animations

**Tailwind Config** (if needed):
- Extend theme with serif font family names
- Add custom animation utilities for stagger effects

### Performance Considerations

- **Font loading**: Use `font-display: swap` to prevent blocking
- **Animations**: CSS-only where possible, GPU-accelerated (transform, opacity)
- **Backdrop blur**: May impact performance on older devices; consider fallback
- **Auto-save debouncing**: Already implemented (2 second delay)

### Accessibility Requirements

- Maintain keyboard navigation for all interactive elements
- Ensure focus indicators remain visible
- Sidebar keyboard shortcut (Cmd+\\) for power users
- Auto-save status communicated to screen readers
- Maintain proper heading hierarchy
- Color contrast ratios meet WCAG AA standards

## Success Metrics

- **Reduced visual clutter**: Remove 80%+ of visible borders/containers
- **Improved focus**: Auto-hide sidebar keeps attention on content
- **Seamless editing**: Zero mode-switching friction
- **Editorial quality**: Beautiful typography elevates the experience
- **Consistent integration**: Editor feels special but remains part of Orbit

## Open Questions

None - design is complete and validated.

## Future Enhancements

- Real-time collaboration indicators
- Comment/annotation system in margins
- Version history visualization
- AI writing assistance integration
- Table of contents in right margin (on wide screens)
- Keyboard shortcuts panel

## Appendix

### Design Validation

All sections of this design have been validated with stakeholders:
1. ✅ Overall Layout & Structure
2. ✅ Typography & Visual Hierarchy
3. ✅ Sidebar Navigation
4. ✅ Content Editing Experience
5. ✅ Metadata & Supplementary Content
6. ✅ Motion & Interactions
7. ✅ Color & Theme Integration

### References

- Current implementation: `orbit-www/src/app/(frontend)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`
- Editor component: `orbit-www/src/components/features/knowledge/PageEditor.tsx`
- Design system: `orbit-www/DESIGN_SYSTEM.md`
- Global styles: `orbit-www/src/app/globals.css`
- Frontend aesthetics guidance: `.agent/SOPs/frontend-aesthetics.md`
