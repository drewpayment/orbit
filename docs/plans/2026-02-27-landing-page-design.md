# Orbit Landing Page — Design Document

## Overview

Marketing landing page for Orbit, an Internal Developer Portal (IDP). Targets engineering leadership evaluating IDP solutions. Premium, polished aesthetic (Linear/Vercel/Stripe-tier). Routes unauthenticated users to a public marketing page with clear paths to `/login`.

## Routing Architecture

**Approach**: New `(marketing)` route group in Next.js App Router, outside the existing `(frontend)` AuthGuard.

```
orbit-www/src/app/
  (marketing)/          # NEW — public, no auth required
    layout.tsx          # Minimal layout: nav + footer
    page.tsx            # Landing page
  (frontend)/           # Existing — behind AuthGuard
    ...
  (auth)/               # Existing — login/signup
    login/page.tsx
    signup/page.tsx
```

The root `page.tsx` currently lives in `(frontend)/` and is behind AuthGuard. We need to either:
1. Move the root route to `(marketing)/` and ensure it takes precedence, OR
2. Create a root-level `page.tsx` that redirects/renders the marketing page

**Decision**: Create `(marketing)/page.tsx` as the new root. Update middleware to not redirect `/` to `/login` for unauthenticated users.

## Visual Design

**Design file**: `docs/design.pen` → "Landing Page" frame

### Color Palette (uses existing design tokens)
- Background: `#0A0A0B` (deep black)
- Card surfaces: `#141417`
- Primary accent: `$--primary` (warm orange `#E8732A`)
- Text primary: `#FFFFFF`
- Text secondary: `#ADADB0`
- Text muted: `#8B8B90`
- Borders: `#FFFFFF0D` / `#FFFFFF1A`

### Typography
- Headlines: **Instrument Serif** (display, 40-64px)
- Body/UI: **Inter** (14-19px)
- Section labels: Inter uppercase, 12px, letter-spacing 2px, orange

### Page Sections

#### 1. Header (sticky nav)
- Left: Orbit logo icon + "ORBIT" wordmark
- Center: Anchor links — Features, How It Works, Get Started
- Right: "Log In" text link + "Get Started" orange CTA button

#### 2. Hero
- Orange pill badge: "Internal Developer Portal"
- Headline: "Your engineering platform, one portal." (Instrument Serif, 64px)
- Subheadline: Value prop paragraph (Inter, 19px, muted)
- CTA row: "Get Started" (primary) + "See How It Works" (outline)
- Product screenshot placeholder (1100x620, rounded, subtle glow shadow)
- Radial gradient background for depth

#### 3. Feature Grid (2×2)
Section header: "CAPABILITIES" label + "Everything your platform team needs" title

| Feature | Icon | Color | Description |
|---------|------|-------|-------------|
| Kafka Self-Service | workflow | orange | Provision virtual clusters, manage topics, enforce policies |
| API Catalog | book-open | blue | Discover, document, govern APIs with OpenAPI/AsyncAPI |
| Knowledge Hub | file-text | green | Collaborative wikis with full-text search |
| GitOps Native | git-branch | purple | Bidirectional GitHub sync |

Cards: dark surface (`#141417`), 12px radius, 28px padding, colored icon containers

#### 4. How It Works (3 steps)
Section header: "HOW IT WORKS" label + "Up and running in minutes" title

| Step | Color | Title | Description |
|------|-------|-------|-------------|
| 1 | orange | Connect | Link GitHub repos and infrastructure |
| 2 | blue | Catalog | Auto-discover APIs, services, Kafka topics |
| 3 | green | Govern | Set policies, manage access, self-serve safely |

Numbered circles with tinted backgrounds, centered text below

#### 5. Final CTA
- Headline: "Ready to bring order to your platform?" (Instrument Serif, 48px)
- Subline: "Start building your Internal Developer Portal today."
- CTA: "Get Started" button + "or Log In →" text link
- Radial gradient background

#### 6. Footer
- Left: Orbit logo + name (muted)
- Right: Privacy, Terms, Documentation links
- Bottom: "© 2026 Orbit. All rights reserved."

## Technical Requirements

### Middleware Changes
- Update `middleware.ts` to allow unauthenticated access to `/` (marketing routes)
- The `(frontend)` AuthGuard remains unchanged

### No Payload CMS Dependency
- Landing page is pure React + Tailwind — no Payload collections or API calls
- Static content, no database queries

### Responsive Considerations
- Desktop-first (1440px design), responsive down to mobile
- Feature grid: 2×2 on desktop, stacked on mobile
- How It Works: horizontal on desktop, vertical on mobile
- Nav collapses to hamburger on mobile

### Performance
- No client-side JS required for initial render (server component)
- Smooth scroll for anchor links (client island)
- Stagger-reveal animations using existing CSS from globals.css

## UI Stack
- Tailwind v4 (existing)
- Lucide icons (existing)
- shadcn/ui components where applicable (buttons)
- Instrument Serif font (needs to be added — currently have Crimson Pro + Source Serif 4)
- Inter font (already available)
