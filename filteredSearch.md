# Tender Search – Condensed Implementation Plan

## Objective
Transform the basic tender search into an Upwork‑style advanced discovery tool for Pakistani contractors, with full‑text search, rich filters, sorting, pagination, shareable URLs, and plan‑gated visibility.

## User Stories (Abbreviated)
- Keyword search tender fields.
- Filter by province, city, sector, department, date range, bid security, estimated value, PEC category, eligibility.
- Sort by relevance, date, closing deadline, value, recommendation score.
- Share search results via URL.
- Free users get limited preview; paid users see full details.
- Admin respects tender status (hide drafts).

## Implemented Backend Design

### Database
- Uses the existing generated `search_document tsvector` on `tenders`, with a GIN index.
- Added filter-support indexes for status/source/closing date, province/city, sector, department trigram search, estimated value, bid security, PEC extracted fields, and recommendation status/score.
- Recommendation scores are loaded server-side for authenticated organizations and merged into paid/ops responses.

### API: `GET /api/tenders`
**Auth:** Optional (public gets limited fields).  
**Parameters (all optional):**
- `q` – full‑text search
- `province`, `city`, `sector`, `source`, `department`
- `closing_date_after`, `closing_date_before`
- `bid_security_min`, `bid_security_max`
- `estimated_value_min`, `estimated_value_max`
- `tender_status` (default published)
- `pec_category`
- `eligible_only` (boolean, uses recommendations)
- `sort` (relevance, newest, closing_soon, estimated_value_asc/desc, bid_security_asc/desc, recommendation_score)
- `page`, `limit` (max 50)

**Response:** `{ data: [...], pagination: { page, limit, total, totalPages }, meta: { planAccess, appliedFilters } }`  
- Free/public users: only `title`, `department`, `location`, `closing_date`, `sector`, short description; no value/security/documents.

**Implementation:**
- Server-side validation uses `tenderSearchSchema` in `packages/shared`.
- `apps/web/lib/tender-search.ts` centralizes query construction, plan gating, pagination, PEC filtering, recommendation sorting, and free/public field stripping.
- `GET /api/tenders` returns the documented `{ data, pagination, meta }` shape directly.
- Legacy aliases `source_id`, `deadline_from`, `deadline_to`, `status`, `page_size`, `closing_date`, and `estimated_value` normalize to the new contract.

**Security:** Rate‑limit 30 req/min; always force `status = 'published'` for non‑admins.

## Implemented Frontend Design

### Layout
- Authenticated contractor search uses the existing app route `/search`.
- Public preview search uses `/tenders`.
- `/search` uses a two-column filter/results layout with keyword, province, city, sector, department, source, date range, bid security range, estimated value range, PEC category, status for ops, sort, limit, and eligible-only filters.
- `/tenders` exposes the public-safe subset of filters and public preview cards.

### State Management
- Filters are shareable through standard GET query parameters.
- The current implementation is server-rendered through Next.js App Router pages, not a React Query client hook.

### Components
- Existing shared UI primitives render filter controls, result cards, and pagination links.
- Result card content adapts to `meta.planAccess`; free/public cards omit sensitive commercial fields.

### Plan Gating
- Free/public responses do not include sensitive fields, so the UI cannot accidentally render value, bid security, source URL, document fee, or document links.
- `eligible_only` is available only for authenticated organizations with recommendation rows; unauthenticated usage returns no eligible matches.

## Implementation Status
1. **DB migration** – implemented with generated `search_document`, search/filter indexes, and published-only public RLS.
2. **API route** – implemented with Zod validation, optional auth, rate limiting, plan gating, and documented response shape.
3. **Contract tests** – implemented for search schema normalization, indexes, and public RLS guarantees.
4. **Authenticated UI** – implemented on `/search` using URL-backed GET filters.
5. **Public UI** – implemented on `/tenders` with public-safe previews.
6. **Public detail safety** – implemented by filtering to published tenders and removing bid security/value exposure.
7. **Remaining polish** – active filter chips, debounced client search, saved-search prefill, and mobile drawer can be added when there is a component need.

## Alignment with SE Principles
- **Modularity:** Separate API, UI, filter components.
- **Separation of Concerns:** API handles query; UI pure display.
- **Abstraction:** Stored procedure hides complex SQL.
- **Rigor:** Zod validation, whitelisted values.
- **Robustness:** Rate limiting, consistent error responses.
- **Incrementality:** Steps build and test independently.
