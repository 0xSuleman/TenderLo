# Code Quality Improvement Plan – Pakistan Tender Intelligence SaaS

**Goal:** Refactor the existing codebase to strictly adhere to the Software Engineering Principles defined in `se-principles.md`, adopt industry‑standard coding practices, improve maintainability, and ensure the platform is production‑ready.

This plan is designed to be executed by an AI agent (e.g., Codex) with full access to the monorepo. Every step references the relevant principle(s) and provides specific, actionable instructions.

---

## 1. Preparation & Understanding

Before any changes, ensure the agent has read and understood the following files in the repository root:

- `CONTEXT.md` – full product specification and stack
- `AGENTS.md` – hard rules, mistake log, and workflow constraints
- `se-principles.md` – the 12 principles that must govern all code
- `DIAGRAMS.md` – architecture, data flow, component relationships
- `README.md` – local setup, auth flow, architecture overview

---

## 2. Phase 1: Codebase Audit & Violation Identification

**Relevant Principles:** *Rigor and Formality, Correctness, Cohesion, Coupling*

Conduct a full‑text audit of every source file (`.ts`, `.tsx`, `.sql`, `.css`) to identify violations. Produce a report listing issues by severity:

- **Critical:** Breaks core functionality, data integrity, or tenant isolation.
- **High:** Breaks a SE principle and leads to unmaintainable code.
- **Medium:** Deviates from best practices but does not immediately break the system.

### Audit Checklist

1. **Package Boundary Leaks**
   - Does any file in `packages/parsing` import from `packages/scoring` or vice versa? (Violates *Modularity*, *Coupling*)
   - Does any UI component (`apps/web`) contain business logic for recommendations, compliance, or parsing? (Violates *Separation of Concerns*)

2. **Direct Database Access**
   - Are there any raw SQL queries or Supabase client calls inside UI event handlers? (Violates *Abstraction*, *Separation of Concerns*)
   - Are there any API routes that bypass service/action layers and execute database mutations directly without authentication checks? (Violates *Rigor*, *Robustness*)

3. **Mixed Responsibilities**
   - Does any single file handle two or more unrelated concerns (e.g., scraping + billing)? (Violates *Cohesion*)
   - Is there a “giant utility” file that mixes helpers for dates, tenders, profiles, and notifications? (Violates *Cohesion*)

4. **Missing Evidence & Audit Trails**
   - Do all `extracted_fields` store `evidence_text` and `source_method`? (Violates *Rigor*)
   - Are admin edits logged in `audit_logs`? (Violates *Rigor*, *Robustness*)
   - Are payment webhook handlers verifying signatures before changing subscription state? (Violates *Correctness*)

5. **Hard‑Coded Values & Magic Numbers**
   - Are rate‑limits, confidence thresholds, PEC limits, and scoring weights scattered as literals? (Violates *Anticipation of Change*)
   - Are environment variables used consistently for all secrets and provider keys? (Violates *Rigor*)

6. **Error Handling & Resilience**
   - Do source adapters crash the entire worker if one source fails? (Violates *Robustness*)
   - Are API routes returning raw error objects (`throw new Error()`) without controlled status codes? (Violates *Robustness*)
   - Are there try/catch blocks that simply log and do nothing, leaving the system in an inconsistent state? (Violates *Correctness*)

7. **Test Coverage**
   - Are the critical data‑pipeline functions (parsing, extraction, dedup, scoring) covered by unit tests? (Violates *Correctness*)
   - Are RLS policies tested with integration tests? (Violates *Rigor*)

**Action:** Generate a structured audit report (e.g., `AUDIT_REPORT.md`) with file paths, violation type, and suggested fixes. This will guide all subsequent refactoring.

---

## 3. Phase 2: Core Architecture Refactoring

**Relevant Principles:** *Modularity, Abstraction, Coupling, Cohesion, Anticipation of Change*

Ensure that the monorepo’s package dependencies align exactly with the allowed dependency graph from `DIAGRAMS.md`. Refactor if current imports break these rules.

### 3.1 Enforce Package Boundaries

- In `packages/shared`: contain only Zod schemas, TypeScript enums, constants, and generic utility functions (string/number manipulation). No business logic.
- In `packages/db`: contain only database client initialisation, migration files, generated types, seed data, and RLS policy SQL. Do not add query functions – leave those to the respective service layer.
- In `packages/sources`: each adapter must implement a common `SourceAdapter` interface (defined in `shared`). No adapter may import from `parsing` or `intelligence` – it only returns raw payloads.
- In `packages/parsing`: PDF, DOCX, HTML extraction utilities. Must not depend on `sources`, `intelligence`, `scoring`. Input: file data / HTML string; Output: extracted text array.
- In `packages/intelligence`: field extraction, classification, dedup. May import from `parsing` (for parsed text) and `shared` (for rules). Must not import from `sources` – it works with normalised text.
- In `packages/scoring`: recommendation engine, compliance checks. May import from `shared` and `db` (for reading profile/tender data). Must not import from `sources` or `parsing`.
- In `packages/notifications`: email/WhatsApp adapters. May import from `shared`; should not import from `sources` or `scoring`.
- In `apps/web`: UI components, server actions, API routes. Import only from `shared`, `db` (types), and `notifications` (for alert prefs). Never import worker packages directly.
- In `apps/worker`: job orchestration. Import from all packages (through their public APIs). Must not import from `apps/web`.

**Refactoring Actions:**
1. For every import that violates the above, move the offending logic to the correct package or create a new shared abstraction.
2. If two packages are tightly coupled (e.g., `intelligence` and `scoring` have circular dependencies), introduce a shared contract (e.g., `ScoringInput` type) in `shared` and refactor to depend on that.
3. Move all hard‑coded weights, thresholds, and limits to a central configuration file in `shared` (e.g., `src/config.ts`) and use environment variables for overrides.

### 3.2 Abstraction & Dependency Inversion

- Create provider interfaces in `shared` for `INotificationProvider`, `IBillingProvider`, `IStorageProvider` (if not already). The actual implementations live in their respective packages and are injected into the worker/web via a factory.
- Refactor source adapters to be registered dynamically (e.g., an adapter registry in `sources/index.ts`) so that adding a new source only requires adding a new file, not modifying core ingestion code.
- In the worker, hide the complexity of the pipeline behind a `PipelineOrchestrator` class that exposes `run(sourceId: string): Promise<void>` and internally calls `ingestSource`, `parseDocuments`, etc. Caller never touches details.

**Check:** After refactoring, run type‑checking across the monorepo (`npm run typecheck`) and fix all errors.

---

## 4. Phase 3: Module‑by‑Module Code Quality Improvements

**Relevant Principles:** *Separation of Concerns, Cohesion, Coupling, Robustness, Correctness*

For each package, apply industry‑standard practices:

### 4.1 `packages/shared`
- All constants and enums must be in singular, well‑named files (e.g., `tender-status.enum.ts`, `pec-category.enum.ts`).
- Zod schemas must be strict (no `passthrough()`) and include descriptive error messages.
- Expose a clean barrel export (`index.ts`) that only exports public items; avoid deep imports.
- Add unit tests for any validation or filtering logic.

### 4.2 `packages/db`
- Migrations must be idempotent (use `IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
- RLS policies must be comprehensive: test every table’s `FOR SELECT`, `FOR INSERT`, etc., with different roles.
- Seed file must be self‑contained and create the ops_admin account as documented.
- Include a README explaining how to apply migrations and seed.

### 4.3 `packages/sources`
- Each adapter must implement: `fetchListings(): Promise<ListingResult[]>` and optionally `fetchDetail(url: string): Promise<DetailResult>`. Both types defined in `shared`.
- Rate limiting must be implemented as a decorator or middleware, not copy‑pasted in each adapter.
- On failure, adapter must throw a typed `SourceError` with `retryable: boolean`. The ingestion run handler decides whether to disable.
- Adapters must never store state; they are stateless functions.
- Newspaper adapters must handle OCR as part of the fetching process? No, they should only return the raw image/text blob; parsing/OCR belongs in `parsing`. Clarify: according to `CONTEXT.md`, newspaper pipelines involve OCR, but from adherence to *Separation of Concerns*, the adapter should only save the raw file (image/HTML) to the snapshot bucket and leave OCR to the parsing step. So refactor if needed.

### 4.4 `packages/parsing`
- Each parser (PDF, DOCX, HTML) should be a separate function exposed from `index.ts`.
- OCR integration via Tesseract should be encapsulated in a dedicated `ocr.ts` function that accepts image buffer and returns text + confidence.
- All parsers must return a standardised `ParsedPage[]` structure.
- Handle edge cases: corrupt PDF, empty pages, extremely large files (stream instead of loading entirely into memory).
- Add logging for each parsing stage (e.g., `logger.info('Starting OCR on page X')`).

### 4.5 `packages/intelligence`
- Extraction rules should be loaded from the database but cached with TTL; implement a `RuleService` class.
- Field extraction functions must be pure: `extractClosingDate(text: string, rules: Rule[]): ExtractionResult`.
- Classification must also be pure – input text, output sector matches.
- Deduplication logic should be a separate function `detectDuplicates(existing: Tender[], candidate: Tender): DedupResult`.
- All extraction results must include `evidence_text` and `confidence_score`.
- If confidence < threshold, the function should still return the result but set `needsReview: true`. The pipeline then creates a QA task.
- Avoid large monolithic classes; prefer a set of pure functions organised by concern.

### 4.6 `packages/scoring`
- RECON calculation must be isolated in `calculateReconScore(profile, tender): ReconScore`.
- Compliance checking must be a separate function `checkCompliance(profile, tender): ComplianceReport`.
- Blockers, warnings, and missing documents should be returned as structured arrays, not simple strings, to enable UI rendering.
- Profile completeness score calculation should also be in this package.

### 4.7 `packages/notifications`
- Define `sendEmail(options: EmailOptions): Promise<SendResult>` and `sendWhatsApp(options: WhatsAppOptions): Promise<SendResult>`.
- Use an adapter pattern: `emailAdapters` and `whatsappAdapters` with a factory that selects based on configuration.
- Queue and retry logic should belong to a `NotificationService` that uses a message queue; for now, a simple in‑memory retry with exponential backoff is fine, but keep it abstracted.
- Log all delivery attempts to `notifications` table.

### 4.8 `apps/web`
- All server actions must validate input using Zod schemas from `shared`, check authentication, authorise via membership, and return a controlled `ActionResponse` (e.g., `{ success: boolean, error?: string }`).
- API routes must follow the same pattern.
- UI components must be split: `components/ui` (reusable shadcn), `components/features/...` (domain‑specific), and `app/...` (pages). No business logic in components; always call a custom hook (`useComplianceCheck()`) or server action.
- Error boundaries should be used sparingly; prefer returning error states.
- Use suspense and loading skeletons for all data‑fetching routes.

### 4.9 `apps/worker`
- All jobs must be idempotent: check for existing ingestion runs, duplicate tenders, etc., before writing.
- Use a simple queue library (BullMQ with Redis) if you want to scale, but for MVP, a cron‑based script is acceptable; just ensure the code structure supports swapping.
- Centralise error handling: wrap each job in a `logger` and a try/catch that updates the run status and creates QA tasks.
- Do not use `process.exit()` on error; instead, mark the job as failed and continue with next source.

---

## 5. Phase 4: Enforcing Industry‑Standard Practices

### 5.1 Error Handling & Logging

- Adopt a structured logger (e.g., `pino`) and configure it in each app/package. Log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
- Every catch block must log the error with contextual information (source ID, tender ID, user ID).
- Create a custom error hierarchy:
  - `AppError(base)` with `statusCode`, `code`, `retryable`.
  - Subclasses: `ValidationError(400)`, `NotFoundError(404)`, `UnauthorizedError(401)`, `SourceFetchError(503, retryable: true)`, `PermanentSourceError(503, retryable: false)`.
- API routes must catch these and return appropriate HTTP responses.

### 5.2 Security & Data Integrity

- Verify that all Supabase RLS policies are in place for every tenant‑owned table. Write integration tests that spin up test organisations and attempt cross‑access.
- Ensure that the service role key (used by worker) is never exposed to the client. The worker reads it from environment variables only.
- Validate all file uploads (size, MIME type) server‑side. Profile documents must be scanned for viruses? (optional for MVP, but mention)
- Sanitize user input in search queries to prevent SQL injection; parameterised queries are fine with Postgres.
- Add rate limiting to all public and authenticated API routes (e.g., using `upstash/ratelimit` or custom middleware).

### 5.3 Testing

- **Unit tests:** For all pure functions in `shared`, `parsing`, `intelligence`, `scoring`. Use Jest with TypeScript.
- **Integration tests:** Use a test Supabase project; test source ingestion (mock HTTP requests with `nock`), test document parsing end‑to‑end, test compliance checks with seeded data.
- **E2E tests:** (Optional for quality improvement, but could be added) Use Playwright for critical user journeys: signup–onboarding–profile completion–search–recommendations.
- Aim for >80% code coverage on core packages.
- Add a `npm run test:all` script that runs all test suites.

### 5.4 Code Formatting & Linting

- Integrate ESLint with Prettier across the monorepo. Share the config via `eslint-config-custom` package.
- Add a pre‑commit hook (Husky + lint‑staged) to format and lint changed files.
- Enforce naming conventions: camelCase for variables/functions, PascalCase for classes/components, UPPER_SNAKE_CASE for constants.
- No `any` unless truly unavoidable; use `unknown` and type guards.

### 5.5 Documentation

- Every package must have a README explaining its purpose, public API, and configuration.
- All public functions must have JSDoc comments.
- API routes must have OpenAPI comments (optional but good practice).

### 5.6 Configuration Management

- All configurable values must be externalised via environment variables (with sensible defaults in `shared/config.ts`).
- Use a `.env.example` file listing every required variable.
- For the monorepo, use a single `turbo.json` for task orchestration (if using Turborepo). Ensure `dev`, `build`, `lint`, `test` pipelines are defined.

---

## 6. Phase 5: Refactoring Execution Plan (Incremental)

**Relevant Principles:** *Incrementality, Refinement*

Execute the refactoring in small, verifiable steps to avoid breaking the system.

### Step 1: Fix Critical Violations
- Address all audit findings marked ‘Critical’ first (e.g., missing RLS policies, webhook verification, evidence storage).
- Run the existing test suite after each batch to ensure no regressions.

### Step 2: Enforce Package Boundaries & Dependencies
- Reorganise imports and break circular dependencies.
- Run `npm run typecheck` after each change.

### Step 3: Improve Module Cohesion
- Split large files into smaller, single‑responsibility files.
- Ensure every function does one thing well.

### Step 4: Add/Improve Testing
- Write unit tests for the newly refactored pure functions.
- Write integration tests for the pipeline steps.
- Run the test suite after each module.

### Step 5: Standardise Error Handling & Logging
- Replace all ad‑hoc error throwing with custom `AppError` subclasses.
- Add structured logging to the most critical paths (ingestion, billing webhook).

### Step 6: Documentation & Linting
- Add missing JSDoc and README files.
- Configure ESLint/Prettier and run format on the entire codebase.

### Step 7: Final Integration Testing
- Run the full ingestion pipeline with a real test source (or mocked) and verify data flows correctly to the frontend.
- Perform a security review of RLS with integration tests.

---

## 7. Acceptance Criteria for Code Quality

After completing all phases, the codebase must meet these criteria:

1. **No SE principle violations** – pass a re‑audit using the Phase 1 checklist.
2. **All package imports respect the dependency graph** – verified by a custom ESLint rule (e.g., `no-restricted-imports`).
3. **Test coverage** ≥ 80% for `packages/intelligence`, `packages/scoring`, `packages/parsing`; ≥ 60% overall.
4. **Zero TypeScript errors** and zero ESLint warnings.
5. **All API routes return consistent `ActionResponse` or proper HTTP status codes**.
6. **Ingestion worker idempotent** – running the same source twice yields no duplicate tenders or notifications.
7. **Error logs** exist for every caught exception, and QA tasks are created for low‑confidence data.
8. **Security**: RLS tests pass, signed URLs work correctly, secrets not exposed in client bundles.

---

## 8. Continuous Quality Assurance

After the initial refactoring, integrate these practices into the development workflow:

- **Pre‑commit hooks** run linting and unit tests.
- **CI/CD pipeline** (GitHub Actions) runs full test suite, type check, and security audit on every PR.
- **Periodic code reviews** against the SE principles checklist.
- **Monitor** QA task queue to identify extraction rule weaknesses and improve rules over time.

---

## 9. Summary

This plan transforms the existing codebase into a robust, maintainable, and industry‑standard SaaS application. By systematically addressing each principle from `se-principles.md` and applying rigorous engineering practices, the resulting code will be easier to extend, safer to operate, and fully aligned with the product vision described in `CONTEXT.md`.

Execute the steps in order, commit each successful increment, and continuously verify against the acceptance criteria. The result will be a codebase that any professional developer can confidently work on.