# Code Quality Audit Report

Date: 2026-05-05

Scope: Full-text audit of `apps`, `packages`, `tests`, database migrations, and project Markdown against `codeQuality.md`, `se-principles.md`, `CONTEXT.md`, and `DIAGRAMS.md`.

## Critical Findings

| Status | File(s) | Violation | Fix |
|---|---|---|---|
| Fixed | `apps/web/app/api/tenders/[id]/compliance-check/route.ts`, `apps/web/app/api/recommendations/rebuild/route.ts` | User-facing web API routes imported `@tenderlo/worker/jobs`, coupling authenticated app behavior to worker orchestration. | Moved reusable compliance and recommendation persistence entry points to `packages/scoring` and updated these routes to import `@tenderlo/scoring`. |
| Fixed | `packages/db/migrations/0001_initial_schema.sql`, `supabase/migrations/0001_initial_schema.sql` | Persistence layer needed stronger idempotency and ops policy coverage for generated data writes. | Added dedupe index for `extracted_fields`, ops-admin all-table policy generation, and private storage write policies in the previous persistence pass. |
| Fixed | `apps/web/lib/billing.ts`, `apps/web/app/api/billing/payfast/webhook/route.ts` | Payment webhook errors were generic and subscription period constants were embedded inline. | Added typed validation errors and moved billing period/plan prices into shared runtime config. |

## High Findings

| Status | File(s) | Violation | Suggested Fix |
|---|---|---|---|
| Partially fixed | `apps/worker/src/jobs.ts`, `packages/intelligence/src/index.ts`, `packages/parsing/src/index.ts`, `packages/sources/src/index.ts`, `packages/scoring/src/index.ts` | Confidence thresholds, rate limits, parser limits, recommendation alert thresholds, and scoring weights were scattered as literals. | Added `packages/shared/src/config.ts` and wired the highest-risk runtime values through shared config. Continue moving UI pagination/display-only limits only when they affect backend contracts. |
| Partially fixed | `apps/worker/src/index.ts`, `apps/worker/src/jobs.ts`, `packages/parsing/src/index.ts` | Caught exceptions used ad hoc `console.*` logging. | Added a structured `logger` in `packages/shared` and used it in worker and parsing paths. Continue replacing incidental route-level logs as routes are touched. |
| Open | `apps/web/app/api/worker/*` | Worker-trigger API routes still import `@tenderlo/worker/jobs`. These routes are worker HTTP entrypoints, not user-facing SaaS routes, but they still technically violate the strict dependency statement in `codeQuality.md`. | Longer-term fix: move orchestration into a dedicated package allowed by the dependency graph or deploy worker HTTP endpoints from `apps/worker` directly. |
| Open | `apps/web/app/api/*` | API routes consistently use auth helpers and `fail()`, but many still perform direct Supabase mutations instead of a service layer. | Introduce service modules package-by-package when behavior becomes shared; avoid creating a generic data layer that hides RLS/audit requirements. |
| Open | `package-lock.json` dependency tree | `npm install framer-motion -w @tenderlo/web` reported 5 dependency vulnerabilities, including 1 high. | Run a targeted `npm audit` review and upgrade affected packages deliberately. Avoid `npm audit fix --force` until breaking changes are understood. |

## Medium Findings

| Status | File(s) | Violation | Suggested Fix |
|---|---|---|---|
| Fixed | `apps/web/lib/api.ts`, `apps/web/lib/supabase.ts`, `packages/notifications/src/index.ts` | API error handling relied on message regexes and generic `Error` for authorization failures. | Added `AppError` subclasses in `packages/shared/src/errors.ts`; `fail()` now returns typed status/code responses for those errors. |
| Fixed | `apps/web/app/api/tenders/route.ts`, `apps/web/lib/tender-search.ts`, `apps/web/app/search/page.tsx`, `apps/web/app/tenders/page.tsx` | Tender search used a legacy parameter set, did not return the documented `{ data, pagination, meta }` response, and mixed free/paid visibility rules into the route. | Added shared search validation, centralized query/plan-gating logic, URL-backed filters, rate limiting, and published-only public visibility. |
| Open | `packages/shared/src/index.ts` | Shared package remains a large barrel that mixes schemas, interfaces, constants, and utilities. | Split constants/schemas/types into smaller files gradually. The new `config.ts`, `errors.ts`, and `logger.ts` are first steps. |
| Open | `packages/db/src/index.ts` | `packages/db` contains helper functions beyond client initialization and migrations. | Current app depends on these helpers. Move profile/completeness query behavior toward `packages/scoring` and feature services incrementally. |
| Open | `apps/web` pages | Server components query Supabase directly for page data. | Acceptable for current server-rendered pages when using authenticated server context, but shared business mutations should continue moving into package/service functions. |

## Verification

- Package dependency scan: no package-to-package circular import was found in the current source audit.
- Evidence-backed extraction tables, QA tasks, private buckets, and RLS policies are present in migrations.
- Existing tests cover parsing, deterministic intelligence, scoring/compliance, and schema contract checks.
- `npm run typecheck` and `npm test` passed after this refactor pass.
- Tender search schema/index/RLS guarantees are covered by `tests/integration/schema.test.ts`.
- `npm run build -w @tenderlo/web` passed after the UI/UX enhancement pass.
