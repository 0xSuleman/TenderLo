# TenderLo

TenderLo is a Pakistan Tender Intelligence SaaS for contractor companies. It combines official tender portals, publicly accessible newspaper notices, deterministic field extraction, Profile Vault compliance checks, RECON recommendations, QA review, alerts, and billing.

## Local Setup

1. Install Node 22+ and npm 9+.
2. Install Supabase CLI and Tesseract OCR on your machine.
3. Copy `.env.example` to `.env.local` and fill Supabase, SMTP, PayFast, and Meta WhatsApp values.
4. Install dependencies:

```bash
npm install
```

5. Apply database migrations with Supabase:

```bash
npm run db:push
```

6. Apply seed data from `packages/db/seeds/seed.sql` through your Supabase SQL editor or local `psql` connection. The seed creates source adapters, extraction rules, and a confirmed local ops admin account:

```text
Email: admin@tenderlo.local
Password: TenderLo Admin123!
Role: ops_admin
```

7. Run the web app:

```bash
npm run dev
```

8. Run worker jobs:

```bash
npm run worker -- ingest-all
```

## Auth Flow

- Public visitors can open marketing, pricing, demo, and tender preview pages.
- Protected SaaS routes redirect unauthenticated users to `/login` with a safe return path.
- Sign-up validates name, email, password length, and password confirmation before creating a Supabase Auth user.
- If Supabase requires email confirmation, sign-up sends the user back to sign in instead of opening onboarding without a session.
- Authenticated users without an active organization membership are routed to `/onboarding`; users with membership go to `/dashboard`.

## Architecture

- `apps/web`: Next.js App Router UI and API routes.
- `apps/worker`: Node worker for ingestion, parsing, scoring, and alerts.
- `packages/db`: Supabase clients, migrations, and database helpers.
- `packages/sources`: source adapters for portals, departments, and newspapers.
- `packages/parsing`: local HTML/PDF/DOCX/OCR parsing.
- `packages/intelligence`: deterministic extraction, classification, and dedupe.
- `packages/scoring`: PEC-aware recommendations, compliance checks, and plan gates.
- `packages/notifications`: SMTP, in-app, and Meta WhatsApp notification delivery.
- `packages/shared`: schemas, constants, and shared contracts.

Tender intelligence is deterministic and evidence-backed. Hosted AI, hosted OCR, hosted document-intelligence APIs, and opaque recommendation logic are intentionally not used.

## Tender Search

- Public tender previews live at `/tenders`; authenticated contractor search lives at `/search`.
- `GET /api/tenders` supports `q`, `province`, `city`, `sector`, `source`, `department`, `closing_date_after`, `closing_date_before`, `bid_security_min`, `bid_security_max`, `estimated_value_min`, `estimated_value_max`, `tender_status`, `pec_category`, `eligible_only`, `sort`, `page`, and `limit`.
- The API returns `{ data, pagination, meta }`, where `meta.planAccess` is `free`, `paid`, or `ops`.
- Non-ops searches are forced to `status = published`. Free/public responses omit source URLs, tender values, bid security, document fees, and documents.
- Search uses the generated Postgres `search_document` tsvector plus filter indexes on status/source/closing date, geography, sector, department, estimated value, bid security, PEC extracted fields, and recommendation status/score.

## Frontend Experience

- The web app uses Tailwind design tokens in `apps/web/tailwind.config.ts` and motion-safe global utilities in `apps/web/app/globals.css`.
- Framer Motion powers page transitions, staggered lists, animated counters, progress bars, and RECON score rings through shared components in `apps/web/components/motion.tsx`.
- Shared UI primitives in `apps/web/components/ui.tsx` provide consistent cards, buttons, badges, skeletons, empty states, and metric cards.
- Public pages, auth forms, app shell navigation, dashboard, search, tender previews, recommendations, Profile Vault, billing, documents, alerts, and team screens use the updated visual system.
- Reduced-motion preferences are respected through CSS and motion component fallbacks.

## Persistence Guarantees

- Schema, RLS policies, storage buckets, and seed data live in `packages/db`; the Supabase migration mirror is kept in `supabase/migrations`.
- Private storage buckets are `tender-source-snapshots`, `tender-documents`, and `profile-documents`, with additional private buckets for newspaper clippings and bid-package documents.
- Source adapters pass raw snapshot content when available; the worker stores it with a `content_hash` in `tender-source-snapshots` and records metadata in `raw_source_snapshots`.
- Automated ingestion preserves human-verified tender rows and verified extracted fields, while low-confidence extraction, parser failures, duplicate review, and repeated source failures create deduped QA tasks.
