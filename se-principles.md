# Software Engineering Principles - Pakistan Tender Intelligence SaaS

These principles govern every design and implementation decision in this project.
Agents must consult this file when making architectural or code-level choices.

---

## 1. Modularity

**Definition:** The system is divided into independent, interchangeable units with well-defined boundaries.

**In Pakistan Tender Intelligence SaaS:**

- Keep source adapters, ingestion orchestration, document parsing, OCR, field extraction, classification, deduplication, recommendation scoring, compliance checks, billing, notifications, and UI concerns separate.
- Never merge scraping, parsing, scoring, QA workflows, and billing into one giant module.
- Keep frontend screens separate from reusable components and shared API hooks.
- Keep package boundaries aligned with `CONTEXT.md`: `sources`, `parsing`, `intelligence`, `scoring`, `notifications`, `db`, and `shared`.
- If a module exists only to support one concern, keep it physically and conceptually near that concern.

---

## 2. Separation of Concerns

**Definition:** Each module addresses a distinct concern and does not bleed into another module's responsibility.

**In Pakistan Tender Intelligence SaaS:**

- Source adapters fetch and normalize source-specific raw tender payloads only.
- Parser utilities extract text from HTML, PDF, DOCX, and OCR inputs only.
- Extraction rules identify fields and evidence only.
- Classification logic assigns sectors and procurement categories only.
- Recommendation logic scores tender fit only.
- Compliance logic compares tender requirements against a company profile only.
- Billing logic handles checkout, webhooks, subscriptions, invoices, and plan limits only.
- React components render and interact with UI state; they must not duplicate backend scoring, compliance, or parsing logic.

---

## 3. Abstraction

**Definition:** Hide implementation details behind clean interfaces. Expose only what callers need.

**In Pakistan Tender Intelligence SaaS:**

- Callers should use operations like `ingestSource`, `parseDocument`, `extractTenderFields`, `classifyTender`, `scoreRecommendation`, `runComplianceCheck`, and `sendNotification`.
- Worker orchestration should call public helper functions instead of reaching into private parser, OCR, scoring, or storage internals.
- API consumers should use documented routes, not database tables directly.
- Frontend screens should use typed API wrappers and server actions, not ad hoc fetch logic scattered across components.
- Source adapters should expose a common contract so adding a provincial source does not rewrite the ingestion pipeline.

---

## 4. Refinement

**Definition:** Start with high-level structure and progressively fill in detail. Do not over-engineer before the core workflow works.

**In Pakistan Tender Intelligence SaaS:**

- First define the database schema, RLS policies, storage buckets, auth, and organization model.
- Then implement Profile Vault and manual tender entry.
- Then implement one official portal source adapter, one newspaper source adapter, and the ingestion run record.
- Then add document parsing, OCR fallback, extraction rules, classification, and QA tasks.
- Then add search, recommendations, compliance reports, alerts, billing, and admin workflows.
- Do not tune obscure parser edge cases before the end-to-end tender ingestion and compliance loop works.

---

## 5. Rigor and Formality

**Definition:** Be precise. Use defined contracts and exact specifications, not vague assumptions.

**In Pakistan Tender Intelligence SaaS:**

- Every table, enum, route, role, and feature must match `CONTEXT.md` unless explicitly changed.
- Every extracted field must include method, confidence, evidence, and verification status.
- Unknown compliance data must remain unknown. Do not turn uncertainty into a pass.
- Human-verified tender fields must not be overwritten by automated extraction.
- Payment webhooks must be verified before subscription state changes.
- Admin edits must write audit logs.
- RLS policies must be treated as required product behavior, not optional infrastructure polish.

---

## 6. Anticipation of Change

**Definition:** Design so likely future changes require minimal rework.

**In Pakistan Tender Intelligence SaaS:**

- Keep source adapters independent so new PPRA, provincial, department, and newspaper sources can be added without rewriting the worker.
- Keep field extraction rules data-driven where practical so patterns can improve from QA feedback.
- Keep notification providers behind adapters so email and WhatsApp can evolve independently.
- Keep billing provider logic isolated so PayFast changes do not ripple through plan gating.
- Keep recommendation scoring in one package so PEC rules, weights, and eligibility logic can be updated safely.
- Keep public pages and authenticated app routes separate so marketing changes do not disturb dashboard workflows.

---

## 7. Incrementality

**Definition:** Build and verify in small, working increments. Each increment adds value and is testable.

**In Pakistan Tender Intelligence SaaS:**

- Complete auth, organizations, RLS, and storage permissions before adding sensitive document uploads.
- Complete manual tender entry before automated ingestion.
- Complete one source adapter before generalizing to many sources.
- Complete deterministic field extraction before recommendation scoring.
- Complete recommendation scoring before alerting on recommendations.
- Complete billing webhook verification before enforcing paid feature gates.
- Do not claim completion until signup, Profile Vault, ingestion, search, recommendations, compliance reports, alerts, billing, and admin QA are tested.

---

## 8. Generality

**Definition:** Solve the general problem, not just the single immediate case, but only when it adds real value.

**In Pakistan Tender Intelligence SaaS:**

- A source adapter interface is justified because official portals, department pages, and newspaper/e-paper tender notices have different structures.
- A reusable extraction rule system is justified because tender field formats vary by source and document type.
- A shared compliance engine is justified because Profile Vault, tender detail pages, reports, and alerts all need the same eligibility truth.
- A provider adapter for notifications is justified because email and WhatsApp have different delivery mechanics.
- Do not build plugin marketplaces, complex workflow engines, native apps, or marketplace features unless explicitly requested.

---

## 9. Correctness

**Definition:** The system must do exactly what the specification requires. No more, no less.

**In Pakistan Tender Intelligence SaaS:**

- The ingestion pipeline must fetch portal, department, and newspaper source data, store snapshots, parse documents or clippings, extract fields, classify, dedupe, route uncertainty to QA, publish tenders, rebuild recommendations, and send alerts.
- The Profile Vault must drive recommendations and compliance checks.
- Recommendations must apply hard blockers before scoring.
- Compliance reports must include source tender details, company profile snapshot, checklist, blockers, warnings, unknowns, and timestamp.
- Search must respect tender publication status and subscription visibility rules.
- Billing status must control premium access server-side.
- Public preview access must never leak private company documents or premium tender details.

---

## 10. Robustness

**Definition:** The system behaves sensibly under abnormal conditions such as invalid input, missing records, partial documents, and external source failures.

**In Pakistan Tender Intelligence SaaS:**

- Unauthenticated onboarding, login failures, duplicate sign-up attempts, and email-confirmation flows should produce controlled redirects and page-level messages, not runtime overlays.
- Failed source requests should mark ingestion run errors and continue with other sources.
- Parser failures should create QA tasks and preserve partial tender data.
- OCR failures should not crash ingestion.
- Ambiguous duplicate matches should go to QA instead of being guessed.
- Missing PEC or profile data should create warnings or unknowns instead of passing compliance.
- Expired documents should be handled consistently in dashboard, recommendations, and compliance reports.
- Payment webhook replay or duplication should be idempotent.
- Notification delivery failures should retry and record the error.
- Empty search results should show useful empty states, not broken screens.

---

## 11. Coupling

**Definition:** Minimize dependencies between modules so a change in one does not ripple through unrelated parts of the system.

**Types to aim for:** Data coupling > Stamp coupling >> Control coupling >> Content coupling X

**In Pakistan Tender Intelligence SaaS:**

- Worker orchestration may call extraction and scoring modules, but it must not duplicate their internals.
- Source adapters may return normalized payloads, but they must not write billing data, notifications, or UI state.
- Recommendation scoring may read profile and tender inputs, but it must not perform document parsing.
- React components should receive props and typed API responses; they should not know database implementation details.
- Backend modules should communicate through typed inputs, Zod schemas, and plain return objects rather than shared mutable globals.

---

## 12. Cohesion

**Definition:** Every module should have one clear reason to exist. All its parts should work toward a single purpose.

**Aim for:** Functional cohesion > Sequential > Communicational > Procedural > Temporal > Logical > Coincidental X

**In Pakistan Tender Intelligence SaaS:**

- `sources`: one job - fetch and normalize tender source data.
- `parsing`: one job - extract readable text from documents.
- `intelligence`: one job - extract and classify tender facts from text.
- `scoring`: one job - calculate recommendations and compliance outcomes.
- `notifications`: one job - deliver and log alerts.
- `db`: one job - schema, migrations, policies, generated types, and seeds.
- `shared`: one job - constants, schemas, enums, and common utilities.
- If a file starts handling source fetching, OCR, billing, compliance, and UI formatting, split it.

---

## Quick Checklist

- [ ] Did I read the relevant files before modifying them?
- [ ] Does this change preserve the architecture described in `CONTEXT.md`?
- [ ] Are source adapters separate from parsing?
- [ ] Are parsing rules separate from scoring?
- [ ] Are compliance checks separate from recommendation scoring?
- [ ] Are low-confidence fields routed to QA?
- [ ] Are all extracted fields evidence-backed?
- [ ] Are raw source URLs and snapshots preserved?
- [ ] Are raw snapshots stored in the private `tender-source-snapshots` bucket with content hashes?
- [ ] Are human-verified fields protected from automated overwrite?
- [ ] Are human-verified tender rows protected from automated overwrite?
- [ ] Are repeated QA tasks, extracted fields, and alerts deduped where practical?
- [ ] Are RLS policies preserved for tenant-owned data?
- [ ] Are private documents accessed only through signed URLs?
- [ ] Do auth and onboarding failures resolve to controlled user-facing states?
- [ ] Are billing and webhook changes verified server-side?
- [ ] Are UI controls wired end-to-end to backend contracts and persistence?
- [ ] Is external hosted AI avoided?
- [ ] Does the change preserve explainability?
- [ ] Does the change avoid claiming legal certainty or bid-win certainty?
