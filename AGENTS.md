# AGENTS.md - Pakistan Tender Intelligence SaaS Project Instructions

This file is automatically read by coding agents at the start of every session.
It contains hard rules to follow and a running log of past mistakes to never repeat.

---

## Hard Rules

1. Always read a file before modifying it.
2. Never guess file paths, route names, model names, component names, table names, enum values, source adapter names, or storage bucket names. Verify them from the actual project structure first.
3. Never add unrequested features, extra abstractions, or "improvements" beyond the project brief in `CONTEXT.md`.
4. Never create new files if editing an existing one is sufficient.
5. Always follow the software engineering principles defined in `se-principles.md`.
6. Always align implementation with the Pakistan Tender Intelligence SaaS specification in `CONTEXT.md`.
7. The project stack is Next.js App Router, TypeScript, Tailwind/shadcn, Supabase Postgres/Auth/Storage/RLS, worker services, local parsers, Tesseract OCR, Postgres full-text search, and PayFast. Do not switch the implementation to another stack unless explicitly requested.
8. Do not use external hosted AI APIs for tender analysis, extraction, scoring, recommendations, embeddings, OCR, document intelligence, or summaries.
9. Tender intelligence must be deterministic, explainable, backend-owned, and QA-verifiable. Use parsers, regex rules, source-specific selectors, keyword dictionaries, scoring formulas, OCR, and human review workflows.
10. This is a contractor-only SaaS. Do not broaden the commercial ICP to suppliers, government buyers, public-sector procurement teams, or generic vendors.
11. Target different contractor types in Pakistan: civil, building, roads, MEP, electrical, mechanical, HVAC, plumbing, water/sanitation, telecom/IT infrastructure, oil/gas, and industrial maintenance contractors.
12. Include free public Pakistani newspaper tender/classified/e-paper sources alongside official portals and department sites.
13. Do not bypass newspaper paywalls, login walls, CAPTCHA walls, or access controls. Only use publicly accessible tender notices.
14. Store `evidence_text`, extraction `method`, `confidence_score`, and `verification_status` for every extracted tender field.
15. Low-confidence field extraction, medium-confidence duplicate matches, repeated source failures, and parser failures must create `qa_tasks` for human review.
16. Enforce tenant isolation through Supabase RLS. Frontend filtering is not a security boundary.
17. Store private company and tender documents in private storage buckets with signed URLs only.
18. Preserve original source URLs, raw source snapshots, parser output, newspaper name/publication date when applicable, and manual edit audit logs for tender data auditability.
19. Respect official tender and newspaper source rate limits and use polite scraping behavior. A source adapter must fail safely instead of hammering a broken source.
20. Never overwrite a human-verified tender field with automated extraction output.
21. Never treat missing or unknown compliance data as a pass. Unknown requirements must stay visible as `unknown` or `needs_review`.
22. Expired profile documents, expired PEC licenses, and expired engineer verification records must block or warn in compliance checks according to `CONTEXT.md`.
23. PEC category, project value, specialization, geography, document readiness, and deadline preparation window are the core recommendation inputs. Do not replace them with opaque prediction logic.
24. The platform provides bid-readiness intelligence, not legal advice. Never claim a user is legally guaranteed to qualify or win.
25. Do not add UI controls that are not wired end-to-end to backend contracts, persistence, authorization, and tests.
26. Admin actions that modify tender, profile, billing, source, QA, or membership data must write `audit_logs`.
27. Public pages should market and preview the product. Authenticated dashboard functionality belongs inside the SaaS app.
28. Billing, payment webhooks, subscription state, and plan limits must be verified server-side.
29. Worker jobs must be idempotent where practical: repeated ingestion should deduplicate tenders, preserve sources, and avoid duplicate notifications.

---

## Mistake Log

> Format: [Date] - What went wrong - How to avoid it

- [2026-05-02] - Built a generic tender-alert clone instead of the intended product.
  Always center the product around company Profile Vault, compliance checks, PEC-aware recommendations, document readiness, and ops-verified tender intelligence.

- [2026-05-02] - Broadened the ICP to suppliers, government users, or generic procurement teams.
  Keep the sellable SaaS focused on different types of contractors in Pakistan. Government bodies, departments, and newspapers are data sources, not customer personas.

- [2026-05-02] - Ignored free public newspaper tender notices.
  Include Pakistani newspaper tender/classified/e-paper sources where publicly accessible, and use local OCR plus QA for image-based notices.

- [2026-05-02] - Used hosted AI assumptions for extraction or recommendations.
  Keep all intelligence in-house with deterministic algorithms, local parsing, local OCR, explainable scoring, and human QA.

- [2026-05-02] - Mixed source scraping, document parsing, field extraction, recommendation scoring, billing, and UI behavior into one large module.
  Keep source adapters, parsers, extraction rules, scoring, compliance, billing, notifications, and UI components separate.

- [2026-05-02] - Trusted parsed tender data without evidence.
  Every extracted field must include extraction method, confidence, evidence text, source document/page when available, and verification status.

- [2026-05-02] - Skipped QA for low-confidence extraction.
  Low-confidence dates, bid securities, departments, PEC requirements, duplicate matches, and parser failures must create `qa_tasks`.

- [2026-05-02] - Broke tenant isolation by relying on client-side organization filters.
  Supabase RLS must enforce organization access for every organization-owned table and storage object.

- [2026-05-02] - Added UI controls that only changed local state.
  Every control must be backed by an API route, server-side authorization, persistence, and tests where relevant.

- [2026-05-02] - Ignored PEC category, specialization, or project value rules in recommendations.
  Recommendation logic must apply hard blockers first, then score using the documented RECON formula.

- [2026-05-02] - Treated expired company documents as valid.
  Expired PEC licenses, tax documents, financial certificates, insurance, guarantees, and engineer records must appear as blockers or warnings in compliance reports.

- [2026-05-02] - Overloaded public pages with authenticated dashboard behavior.
  Keep public pages focused on SEO, pricing, previews, and conversion; keep operational workflows inside the authenticated app.

- [2026-05-02] - Allowed source failures to crash the ingestion pipeline.
  Source adapters must log controlled errors, update ingestion run status, create QA tasks when thresholds are crossed, and continue with other sources.

- [2026-05-02] - Claimed legal certainty from automated compliance output.
  Compliance reports must remain bid-readiness guidance with source evidence and user verification reminders.

- [2026-05-03] - Let unauthenticated onboarding submit into a server action that threw a runtime error.
  Guard onboarding with Supabase session checks, redirect unauthenticated users to login, and keep sign-up/sign-in failures as controlled page-level messages.

- [2026-05-05] - Let persistence documentation drift from implementation details for raw source snapshots and idempotency.
  Keep raw source snapshots in the private `tender-source-snapshots` bucket, preserve exact fetched content when adapters provide it, dedupe repeated extracted fields/QA tasks/alerts, and never let automated ingestion overwrite human-verified tender rows or fields.
