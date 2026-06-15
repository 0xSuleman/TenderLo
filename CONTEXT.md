# Pakistan Tender Intelligence SaaS

You are building a full-stack SaaS product called "Pakistan Tender Intelligence SaaS" for Pakistani contractor companies. Build the application end-to-end with no placeholders, no TODOs, and no skipped core files. Every implemented file must be complete, runnable, and aligned with this specification.

---

## Overview

The platform helps contractor companies find, understand, and act on Pakistani tender opportunities. It:

1. Aggregates contractor-relevant tenders from official federal/provincial portals, department sites, and free public Pakistani newspaper tender notices.
2. Downloads and parses tender documents locally.
3. Uses local OCR for scanned documents.
4. Extracts tender fields through deterministic backend rules.
5. Maintains a company Profile Vault for PEC, engineers, equipment, financials, tax documents, and experience documents.
6. Scores tender eligibility and bid readiness.
7. Recommends relevant opportunities with explainable reasons.
8. Sends saved-search and recommendation alerts.
9. Provides an internal ops QA dashboard for low-confidence extraction, source failures, and duplicate review.

The platform is not a simple tender-alert website. Its core value is compliance and bid-readiness intelligence for Pakistani procurement workflows.

The system must use deterministic, in-house backend intelligence: source-specific parsers, regex rules, keyword dictionaries, local OCR, confidence scoring, recommendation formulas, and human QA. Do not send tender data or customer data to hosted AI or hosted document-intelligence APIs.

---

## Product Positioning

Primary promise:

> Help Pakistani contractors find the right tenders faster, understand bid requirements sooner, and reduce avoidable compliance mistakes before bidding.

Differentiators:

- PEC-aware eligibility checks.
- Company Profile Vault tied to tender readiness.
- Evidence-backed tender field extraction.
- Explainable recommendation scoring.
- Human QA for low-confidence tender data.
- Search and alerts across official tender portals, department sites, and free public Pakistani newspaper tender sources.

The product must never claim to guarantee legal eligibility, bid acceptance, or contract award. It provides bid-readiness intelligence and operational guidance.

---

## Target Customers and Users

This is a sellable SaaS for contractors in Pakistan only. Do not broaden the commercial ICP to suppliers, government buyers, generic vendors, or public-sector procurement teams.

Contractor customer types:

- Civil works contractors.
- Building construction contractors.
- Road, highway, and bridge contractors.
- MEP contractors.
- Electrical and power contractors.
- Mechanical, HVAC, plumbing, and fire-safety contractors.
- Water, sewerage, and sanitation contractors.
- Telecom, IT infrastructure, and low-voltage contractors.
- Oil, gas, industrial, and plant-maintenance contractors.
- Small to mid-sized PEC contractors that need tender discovery and bid-readiness support.

User personas inside contractor companies:

- Contractor owner or director.
- Contractor admin.
- Contractor staff who helps search tenders, upload documents, or prepare bid paperwork.
- Estimation, quantity survey, or documentation staff when the contractor has a larger team.
- Internal platform operators and QA staff.

Initial commercial target:

- Construction and infrastructure contractors, especially PEC C-4 to C-2 firms that need better tender discovery and compliance workflows but may not have large in-house tender departments.

---

## Commercial Segmentation and Packaging

The product must be built and marketed as a paid SaaS for contractors. Public tender previews may exist for SEO and acquisition, but the core value must sit behind paid plans.

Contractor segments:

- Small contractors: need simple tender discovery, deadline alerts, and basic document readiness.
- Mid-sized PEC contractors: need recommendations, compliance checks, Profile Vault, newspaper tender coverage, and team workflows.
- Larger contractors: need multi-user access, advanced source coverage, audit trails, manual invoice support, and priority ops support.
- Specialist contractors: need category-specific filtering for electrical, MEP, HVAC, roads, water/sanitation, telecom infrastructure, industrial maintenance, and other contractor niches.

Default paid packaging:

- Starter: tender search, saved searches, basic alerts, limited Profile Vault.
- Growth: full Profile Vault, contractor-specific recommendations, newspaper tender coverage, compliance checks, and team access.
- Pro: advanced compliance reports, more users, priority alerts, source coverage expansion, and ops-reviewed tender data.
- Enterprise: manual invoicing, custom contractor source monitoring, priority support, and higher usage limits.

The platform should monetize contractor pain points: missed tenders, manual newspaper checking, expired documents, weak bid readiness, poor filtering across sources, and avoidable tender disqualification.

---

## Tech Stack

- Frontend: Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui.
- Backend: Next.js server actions and API routes.
- Worker: Node.js worker service with scheduled jobs and queue-ready architecture.
- Database: Supabase Postgres.
- Auth: Supabase Auth.
- Authorization: Supabase RLS on all tenant-owned data.
- Storage: Supabase Storage private buckets with signed URLs. Core bucket names are `tender-source-snapshots`, `tender-documents`, and `profile-documents`; implementation may add private phase-specific buckets such as newspaper clippings and bid-package documents.
- Search: Postgres full-text search.
- Parsing: local HTML, PDF, and DOCX parsers.
- OCR: local Tesseract OCR.
- Billing: PayFast subscription checkout and webhook handling, with manual invoice fallback for enterprise customers.
- Email: provider adapter interface for transactional and alert emails.
- WhatsApp: adapter-ready design; only enable when provider credentials and a full backend contract exist.

Do not use hosted AI APIs, hosted embedding APIs, hosted OCR APIs, or hosted document intelligence APIs.

---

## Required Project Structure

```text
pakistan-tender-intelligence/
├── apps/
│   ├── web/                  # Next.js app, UI, API routes, server actions
│   └── worker/               # ingestion, parsing, OCR, scoring, alerts
├── packages/
│   ├── db/                   # Supabase types, migrations, seeds, RLS policies
│   ├── sources/              # source adapter framework for portals, departments, newspapers
│   ├── parsing/              # HTML/PDF/DOCX/OCR parsing utilities
│   ├── intelligence/         # deterministic field extraction and classification
│   ├── scoring/              # PEC rules, RECON scoring, compliance rules
│   ├── notifications/        # email and future WhatsApp adapters
│   └── shared/               # Zod schemas, constants, enums, utilities
├── AGENTS.md
├── CONTEXT.md
├── se-principles.md
└── README.md
```

Keep project structure aligned with this layout unless the user explicitly requests a different architecture.

---

## Core Data Model

Implement database migrations for these tables.

### `organizations`

- id
- name
- legal_name
- primary_contact_name
- primary_contact_email
- phone
- city
- province
- created_at
- updated_at

### `profiles`

Supabase user profile extension.

- id
- user_id
- full_name
- phone
- created_at
- updated_at

### `memberships`

- id
- organization_id
- user_id
- role: owner | admin | member | viewer | ops_admin
- status: active | invited | suspended
- created_at
- updated_at

### `invitations`

- id
- organization_id
- email
- role
- token_hash
- expires_at
- accepted_at
- created_by
- created_at

### `company_profiles`

- id
- organization_id
- business_type
- ntn
- strn
- website
- operating_regions
- sectors
- profile_completeness_score
- created_at
- updated_at

### `pec_licenses`

- id
- organization_id
- license_number
- category: C-A | C-B | C-1 | C-2 | C-3 | C-4 | C-5 | C-6 | unknown
- specialization_codes
- issue_date
- expiry_date
- verification_status: unverified | verified | expired | needs_review
- created_at
- updated_at

### `engineers`

- id
- organization_id
- full_name
- pec_number
- engineer_type: PE | RE | trainee | unknown
- discipline
- verification_status
- expiry_date
- created_at
- updated_at

### `equipment`

- id
- organization_id
- name
- equipment_type
- capacity
- ownership_type: owned | leased | rented | unknown
- location
- verification_status
- created_at
- updated_at

### `profile_documents`

- id
- organization_id
- document_type
- storage_path
- original_filename
- mime_type
- expiry_date
- verification_status: unverified | verified | expired | rejected | needs_review
- uploaded_by
- created_at
- updated_at

### `tender_sources`

- id
- name
- base_url
- source_type: federal | provincial | department | newspaper | manual
- region
- adapter_key
- scrape_frequency_minutes
- status: active | disabled | failing
- last_run_at
- last_success_at
- consecutive_failures
- created_at
- updated_at

### `ingestion_runs`

- id
- source_id
- status: running | succeeded | failed | partial
- started_at
- completed_at
- tenders_seen
- tenders_created
- tenders_updated
- duplicates_found
- error_message

### `raw_source_snapshots`

- id
- source_id
- ingestion_run_id
- source_url
- content_type
- storage_path
- content_hash
- fetched_at

### `tenders`

- id
- source_id
- canonical_tender_id
- title
- normalized_title
- source_url
- tender_number
- department
- procurement_category
- sector
- province
- city
- description
- advertisement_date
- closing_date
- opening_date
- bid_security_amount
- estimated_value
- document_fee
- status: draft | published | closed | cancelled | corrigendum | under_review
- extraction_confidence
- is_human_verified
- created_at
- updated_at

### `tender_documents`

- id
- tender_id
- source_url
- storage_path
- original_filename
- mime_type
- page_count
- parser_status: pending | parsed | ocr_required | failed
- ocr_status: not_needed | pending | completed | failed
- content_hash
- created_at
- updated_at

### `parsed_document_text`

- id
- tender_document_id
- page_number
- text
- extraction_method: pdf_text | docx_text | html_selector | html_generic | ocr | manual
- confidence_score
- created_at

### `extracted_fields`

- id
- tender_id
- tender_document_id
- field_name
- field_value
- source_method: html_selector | regex | keyword_window | table_rule | ocr | manual
- confidence_score
- evidence_text
- verification_status: unverified | verified | rejected | needs_review
- verified_by
- verified_at
- created_at
- updated_at

### `field_extraction_rules`

- id
- field_name
- rule_type: regex | keyword_window | selector | dictionary | table_rule
- pattern
- source_adapter_key
- confidence_weight
- enabled
- created_at
- updated_at

### `tender_sector_matches`

- id
- tender_id
- sector
- score
- matched_keywords
- is_primary
- created_at

### `duplicate_candidates`

- id
- tender_id
- candidate_tender_id
- confidence_score
- reasons
- status: pending | merged | rejected
- reviewed_by
- reviewed_at
- created_at

### `recommendations`

- id
- organization_id
- tender_id
- score
- status: recommended | warning | blocked | dismissed
- positive_reasons
- warnings
- blockers
- next_action
- calculated_at

### `compliance_checks`

- id
- organization_id
- tender_id
- status: eligible | eligible_with_warnings | not_eligible | unknown
- detected_requirements
- missing_documents
- expired_documents
- warnings
- blockers
- profile_snapshot
- created_by
- created_at

### `saved_searches`

- id
- organization_id
- user_id
- name
- query
- filters
- created_at
- updated_at

### `notification_rules`

- id
- organization_id
- user_id
- saved_search_id
- channel: email | in_app | whatsapp
- frequency: immediate | daily | weekly
- enabled
- created_at
- updated_at

### `notifications`

- id
- organization_id
- user_id
- type
- title
- body
- channel
- status: pending | sent | failed | read
- related_tender_id
- delivery_attempts
- last_error
- created_at
- sent_at

### `subscriptions`

- id
- organization_id
- plan: starter | growth | pro | enterprise
- status: trialing | active | past_due | cancelled | manual_invoice
- provider
- provider_subscription_id
- current_period_start
- current_period_end
- created_at
- updated_at

### `payments`

- id
- organization_id
- subscription_id
- provider
- provider_payment_id
- amount
- currency
- status
- raw_payload
- created_at

### `invoices`

- id
- organization_id
- subscription_id
- invoice_number
- amount
- currency
- status: draft | sent | paid | void | overdue
- due_date
- paid_at
- created_at

### `qa_tasks`

- id
- organization_id nullable
- tender_id nullable
- source_id nullable
- task_type: low_confidence_field | duplicate_review | source_failure | parser_failure | manual_verification
- status: open | in_progress | resolved | dismissed
- priority: low | medium | high | urgent
- title
- details
- assigned_to
- resolved_by
- resolved_at
- created_at
- updated_at

### `audit_logs`

- id
- organization_id nullable
- actor_user_id nullable
- action
- entity_type
- entity_id
- old_value
- new_value
- ip_address
- user_agent
- created_at

---

## EARS Requirements

### Accounts and Organizations

- The system shall allow a user to sign up using email and password.
- The system shall require sign-in before onboarding and shall redirect unauthenticated onboarding attempts to login instead of throwing a runtime error.
- The system shall validate sign-up name, email, password length, and password confirmation server-side before calling Supabase Auth.
- If email confirmation prevents immediate session creation, the system shall send the user to login with a clear confirmation message instead of continuing to onboarding.
- The system shall create an organization workspace during onboarding.
- The system shall require every authenticated user to belong to at least one organization before accessing SaaS features.
- The system shall support the roles `owner`, `admin`, `member`, `viewer`, and `ops_admin`.
- The local seed data shall include a confirmed `ops_admin` account for development and QA access to internal admin workflows.
- Where a user has the `owner` role, the system shall allow billing, member invitation, and organization settings management.
- Where a user has the `viewer` role, the system shall prevent profile edits, document uploads, billing changes, and compliance report generation.
- When a user invites a team member, the system shall send an invitation email and record invitation status.
- If an invited user accepts an expired invitation, the system shall reject the invitation and ask for a new invitation.

### Profile Vault

- The system shall allow each organization to maintain one primary company profile.
- The system shall store legal name, business type, NTN, STRN, city, province, contact person, phone, email, website, and operating regions.
- The system shall allow users to enter PEC category, PEC license number, issue date, expiry date, and specialization codes.
- The system shall allow users to add engineers with PEC number, discipline, engineer type, verification status, and expiry date.
- The system shall allow users to add equipment records with ownership type, capacity, location, and supporting documents.
- The system shall allow users to upload profile documents including PEC license, tax certificate, experience certificate, audited financials, bank letter, insurance, and guarantees.
- When a profile document has an expiry date within 30 days, the system shall show it as expiring soon.
- When a profile document has passed its expiry date, the system shall show it as expired and mark related compliance checks as blocked or warning according to requirement severity.
- The system shall calculate a profile completeness score from required company, PEC, engineer, equipment, tax, and financial fields.
- If a required profile field is missing, the system shall show the missing field in the dashboard readiness checklist.

### Source Ingestion

- The system shall support multiple tender sources.
- The system shall store each source name, URL, source type, region, scrape frequency, adapter type, last run status, and last successful run time.
- The system shall ingest tenders from Federal PPRA/EPADS as the first source.
- The system shall support provincial source adapters for Punjab, Sindh, KP, and Balochistan.
- The system shall support free public Pakistani newspaper tender sources as first-class source adapters.
- The system shall support newspaper/e-paper tender notices from publicly accessible pages such as Dawn, Jang, The News, Express, Nawa-i-Waqt, The Nation, Business Recorder, and other free public tender/classified pages when legally and technically accessible.
- The system shall not bypass paywalls, login walls, CAPTCHA walls, or access controls to collect newspaper notices.
- The system shall preserve newspaper name, publication date, page/section when available, source URL, clipping/image file when available, and OCR text for each newspaper tender notice.
- The system shall store exact adapter-provided raw source snapshots in the private `tender-source-snapshots` bucket and record `content_hash`, `content_type`, and `storage_path` in `raw_source_snapshots`.
- When a scheduled ingestion job starts, the system shall create an `ingestion_runs` record.
- When a source cannot be reached, the system shall record the error and mark the source run as failed.
- If a source fails three consecutive times, the system shall create an admin QA task.
- While a source is disabled, the system shall not run scheduled ingestion for that source.
- The system shall rate-limit requests to official tender sources.
- The system shall rate-limit requests to newspaper sources and respect each source's publicly accessible usage limits.

### Tender Database

- The system shall store normalized tender records.
- A tender shall include title, source, source URL, tender/reference number, department, procurement category, sector, province, city, description, advertisement date, closing date, opening date, bid security, estimated value, document fee, status, and attachments.
- The system shall support tender statuses `draft`, `published`, `closed`, `cancelled`, `corrigendum`, and `under_review`.
- When a tender closing date has passed, the system shall automatically mark the tender as `closed`.
- The system shall preserve the original source URL and raw source snapshot for every ingested tender.
- The system shall not overwrite a tender row marked `is_human_verified = true` with automated ingestion output.
- If a tender is manually edited by an admin, the system shall record the old value, new value, admin user, and timestamp in `audit_logs`.

### Document Parsing

- The system shall download tender attachments into private storage.
- The system shall store newspaper tender notice images or page clippings when the source provides image-based/e-paper content.
- The system shall extract text from PDF files using local PDF parsing.
- The system shall extract text from DOCX files using local DOCX parsing.
- The system shall extract text from HTML pages using source-specific selectors first and generic extraction second.
- If a PDF page, newspaper clipping, or e-paper image has no extractable text, the system shall run local OCR.
- When OCR completes, the system shall store OCR text, page number, confidence, and processing status.
- If document parsing fails, the system shall create a QA task and keep the tender available with partial data.
- The system shall not require a document to be perfectly parsed before the tender can be listed.

### Field Extraction

- The system shall extract tender fields using deterministic backend rules.
- The system shall detect dates using regex patterns and source-specific date formats.
- The system shall detect money values using PKR, Rs, rupees, comma-separated amounts, and million/billion notation.
- The system shall detect bid security using keyword windows around phrases such as `bid security`, `earnest money`, `security deposit`, and `call deposit`.
- The system shall detect closing dates using keyword windows around phrases such as `closing date`, `last date`, `submission deadline`, and `bid submission`.
- The system shall detect PEC category references such as C-A, C-B, C-1, C-2, C-3, C-4, C-5, and C-6.
- The system shall detect province and city using a maintained Pakistan geography dictionary.
- The system shall normalize department names using alias dictionaries.
- Every extracted field shall store method, confidence score, evidence text, and verification status.
- Repeated automated extracted field writes shall be deduped by tender, optional document, field name, value, method, and evidence hash.
- If extracted field confidence is below threshold, the system shall create a QA task.

### Classification

- The system shall classify tenders into sectors using weighted keyword matching.
- Supported contractor sectors shall include construction, roads, highways, bridges, buildings, MEP, electrical, power, mechanical, HVAC, plumbing, fire safety, water, sewerage, sanitation, telecom infrastructure, IT infrastructure, oil and gas works, industrial maintenance, and general contracting.
- The system shall weight title matches higher than document body matches.
- When multiple sectors match, the system shall assign the highest scoring sector and store secondary matches.
- If no sector reaches the minimum confidence threshold, the system shall classify the tender as `uncategorized` and create a QA task.

### Deduplication

- The system shall detect duplicate tenders using source URL, tender number, normalized title, department, closing date, and bid security.
- When duplicate confidence is high, the system shall merge the duplicate automatically.
- When duplicate confidence is medium, the system shall create a QA task for admin review.
- When duplicate confidence is low, the system shall keep both records.
- The system shall preserve all source URLs when duplicate records are merged.

### Search

- The system shall provide full-text search across tender title, description, department, sector, city, and province through the generated Postgres `search_document` tsvector. Source and extracted document text must be preserved for auditability and may be incorporated into ranked search through controlled database changes.
- The system shall allow filtering by `province`, `city`, `sector`, `source`, `department`, `closing_date_after`, `closing_date_before`, `bid_security_min`, `bid_security_max`, `estimated_value_min`, `estimated_value_max`, `eligible_only`, `pec_category`, and `tender_status`.
- The system shall allow sorting by `relevance`, `newest`, `closing_soon`, `estimated_value_asc`, `estimated_value_desc`, `bid_security_asc`, `bid_security_desc`, and `recommendation_score`.
- Search URLs shall be shareable through query parameters. The authenticated SaaS search route is `/search`; the public preview route is `/tenders`.
- `GET /api/tenders` shall return `{ data, pagination, meta }`, where pagination includes `page`, `limit`, `total`, and `totalPages`, and meta includes `planAccess` and `appliedFilters`.
- When a user searches tenders, the system shall return only published tenders unless the user is an ops admin.
- Where a user has an active paid plan, the system shall show full tender details.
- Where a user is on a free/public view, the system shall show limited preview data only and shall not expose source URLs, estimated values, bid security, document fees, private documents, or tender document links.
- Public and authenticated tender search APIs shall be rate-limited.

### Recommendations

- The system shall calculate tender recommendations for each organization.
- The system shall apply hard blockers before scoring.
- The system shall block tenders where the closing date has passed.
- The system shall block tenders where the company PEC category is below the detected project requirement.
- The system shall warn when the company specialization does not clearly match the tender sector.
- The system shall warn when required profile documents are missing.
- The system shall score eligible tenders from 0 to 100.
- The recommendation score shall include PEC/value eligibility, specialization match, geography match, document readiness, experience readiness, and deadline preparation window.
- Every recommendation shall include score, positive reasons, blockers, warnings, and next action.
- When a company profile changes, the system shall rebuild recommendations for that organization.
- When new tenders are published, the system shall rebuild recommendations for affected organizations.

### Compliance Checks

- The system shall allow users to run a compliance check for a tender.
- The compliance check shall compare tender requirements against the company profile.
- The compliance check shall return `eligible`, `eligible_with_warnings`, `not_eligible`, or `unknown`.
- The compliance check shall list missing documents, expired documents, detected requirements, risk flags, and recommended next steps.
- If required data is unavailable, the system shall mark the relevant compliance item as `unknown` rather than passing it.
- The system shall generate a printable compliance report.
- The compliance report shall include source tender details, company profile snapshot, checklist, blockers, warnings, and timestamp.

### Alerts

- The system shall allow users to create saved searches.
- The system shall allow users to subscribe to alerts for saved searches.
- The system shall support immediate, daily, and weekly email alert frequencies.
- When a new tender matches a saved search, the system shall create a notification.
- When a recommended tender score exceeds the organization threshold, the system shall create a notification.
- If a notification delivery fails, the system shall retry according to a retry policy.
- The system shall record all notification attempts and statuses.

### Billing

- The system shall support subscription plans `starter`, `growth`, `pro`, and `enterprise`.
- The system shall integrate PayFast checkout for self-serve subscriptions.
- The system shall support manual invoice status for enterprise customers.
- When a payment webhook is received, the system shall verify the webhook before changing subscription status.
- If payment succeeds, the system shall activate the subscription and update plan limits.
- If payment fails, the system shall mark the subscription as past due and notify the owner.
- While an organization is past due, the system shall preserve data but restrict premium features after a grace period.

### Admin

- The system shall provide an ops admin dashboard.
- The system shall show source health, ingestion status, failed jobs, parsing errors, duplicate candidates, and QA tasks.
- The system shall allow ops admins to manually create and edit tenders.
- The system shall allow ops admins to verify extracted fields.
- The system shall allow ops admins to merge duplicate tenders.
- When an ops admin changes tender data, the system shall write an audit log.
- The system shall allow ops admins to inspect support context without exposing private document downloads unless explicitly permitted.

### Security and Compliance

- The system shall enforce tenant isolation using Supabase RLS.
- The system shall store private documents with signed URL access only.
- The system shall audit profile changes, document access, billing events, admin edits, and role changes.
- The system shall rate-limit authentication, public APIs, and ingestion endpoints.
- The system shall encrypt sensitive environment secrets.
- The system shall provide a privacy policy, terms, and consent notice.
- The system shall allow organization owners to export their organization data.
- The system shall allow organization owners to request account deletion.
- The system shall retain raw tender source snapshots for audit and debugging according to a defined retention policy.

---

## Contractor-Focused Source Coverage

The source strategy must maximize paid value for Pakistani contractors by combining official portals with free public tender notices that contractors already monitor manually.

Initial source categories:

- Federal PPRA/EPADS.
- Provincial PPRA portals.
- Major department and authority tender pages relevant to contractors.
- Free public Pakistani newspaper tender/classified/e-paper notices.
- Manual admin-created tender records for high-value notices that automated adapters miss.

Newspaper source examples:

- Dawn tender/classified notices where publicly accessible.
- Jang tender/classified notices where publicly accessible.
- The News tender/classified notices where publicly accessible.
- Express tender/classified notices where publicly accessible.
- Nawa-i-Waqt tender/classified notices where publicly accessible.
- The Nation tender/classified notices where publicly accessible.
- Business Recorder tender/classified notices where publicly accessible.

Newspaper ingestion requirements:

- Treat each newspaper as its own `tender_sources` adapter.
- Store publication date and newspaper name as primary provenance fields.
- Use local OCR for image-based notices.
- Route low-confidence OCR output to QA before showing extracted dates, bid security, or PEC requirements as trusted.
- Avoid collecting notices from pages that require login, paid access, CAPTCHA bypass, or prohibited scraping behavior.

---

## API Routes

### Organization and Profile

- `POST /api/auth/onboarding`
- `GET /api/organization`
- `PATCH /api/organization`
- `POST /api/invitations`
- `GET /api/company-profile`
- `PATCH /api/company-profile`
- `POST /api/company-profile/documents`
- `DELETE /api/company-profile/documents/:id`

### Tenders

- `GET /api/tenders` with optional filters: `q`, `province`, `city`, `sector`, `source`, `department`, `closing_date_after`, `closing_date_before`, `bid_security_min`, `bid_security_max`, `estimated_value_min`, `estimated_value_max`, `tender_status`, `pec_category`, `eligible_only`, `sort`, `page`, `limit`
- `GET /api/tenders/:id`
- `POST /api/tenders/:id/save`
- `POST /api/tenders/:id/reparse`

### Recommendations and Compliance

- `GET /api/recommendations`
- `POST /api/recommendations/rebuild`
- `POST /api/tenders/:id/compliance-check`

### Saved Searches and Notifications

- `GET /api/saved-searches`
- `POST /api/saved-searches`
- `PATCH /api/saved-searches/:id`
- `DELETE /api/saved-searches/:id`
- `POST /api/notifications/test`

### Billing

- `POST /api/billing/checkout`
- `POST /api/billing/payfast/webhook`

### Admin

- `GET /api/admin/sources`
- `POST /api/admin/sources`
- `PATCH /api/admin/sources/:id`
- `GET /api/admin/qa-tasks`
- `POST /api/admin/qa-tasks/:id/resolve`
- `POST /api/admin/tenders`
- `PATCH /api/admin/tenders/:id`
- `POST /api/admin/tenders/:id/merge`

### Worker

- `POST /api/worker/ingest-source`
- `POST /api/worker/rebuild-recommendations`
- `POST /api/worker/send-alerts`

---

## Worker Pipeline

The ingestion and intelligence worker must:

1. Load active tender sources.
2. Start an `ingestion_runs` record.
3. Fetch source listing pages with rate limits.
4. Store raw source snapshots.
5. Parse listing and detail pages through the source adapter.
6. Download tender attachments.
7. Extract document text locally.
8. Run OCR fallback for scanned pages.
9. Run deterministic field extraction.
10. Classify tender sector and procurement category.
11. Detect duplicates.
12. Create QA tasks for low-confidence extraction, parser failures, source failures, or duplicate ambiguity.
13. Publish verified or acceptable-confidence tenders.
14. Rebuild affected recommendations.
15. Send saved-search and recommendation alerts.
16. Complete the ingestion run with counts and status.

Worker jobs must be safe to retry. Repeated ingestion of the same source must not create duplicate tender records or duplicate customer notifications.

---

## Recommendation Formula

Apply hard blockers first:

- Closing date has passed.
- PEC category is insufficient for detected project value or requirement.
- Required PEC specialization clearly does not match.
- Critical profile document is expired.
- Mandatory requirement is missing and cannot be classified as warning.

Score eligible tenders from 0 to 100:

- PEC/value eligibility: 35 points.
- Sector/specialization match: 25 points.
- Geography match: 15 points.
- Company document readiness: 15 points.
- Deadline preparation window: 10 points.

Every recommendation must include:

- final score
- positive reasons
- warnings
- blockers
- missing documents
- next action

---

## Frontend Screens

### Public

- Home
- Pricing
- Login
- Signup
- Demo request
- Public tender preview
- SEO listing pages

### SaaS App

- Onboarding
- Dashboard
- Tender Search
- Tender Detail
- Recommendations
- Compliance Report
- Profile Vault
- Document Manager
- Saved Searches
- Alerts
- Billing
- Team Settings
- Account Settings

### Admin

- Admin Overview
- Source Health
- Ingestion Runs
- QA Tasks
- Duplicate Review
- Manual Tender Editor
- Customer Support
- Billing Support
- Audit Logs

---

## Testing Requirements

### Unit Tests

- PEC category and project value logic.
- Date parsing.
- Money parsing.
- Bid security parsing.
- Province and city detection.
- Department normalization.
- Sector classification.
- Deduplication scoring.
- Recommendation scoring.
- Compliance status calculation.
- Plan-limit feature gating.

### Integration Tests

- RLS tenant isolation.
- Organization onboarding.
- Document upload permissions.
- Source ingestion run.
- PDF/DOCX parsing.
- OCR fallback.
- QA task creation.
- Billing webhook handling.
- Saved search alert creation.

### End-to-End Tests

- User signs up and creates an organization.
- Owner completes Profile Vault.
- User searches tenders.
- User views recommendation reasons.
- User runs compliance check.
- User creates saved search alert.
- Owner completes billing checkout.
- Ops admin resolves low-confidence extraction.
- Ops admin merges duplicate tender.

### Data QA Targets

Before launch, manually verify at least 100 ingested tenders.

Required launch accuracy targets:

- Closing date: 95%+
- Department/source URL: 98%+
- Bid security: 90%+
- City/province: 90%+
- Sector classification: 85%+

Any field below target must remain in QA review mode before the product makes reliability claims for that field.

---

## Launch Acceptance Criteria

- Users can sign up, onboard, and manage an organization.
- Users can complete a company profile and upload documents.
- Federal PPRA/EPADS ingestion works reliably.
- At least one provincial source adapter works.
- Tender search and filters work.
- Recommendations are generated with explainable scoring.
- Compliance reports are generated from tender and profile data.
- Saved search email alerts work.
- Billing and plan gating work.
- Ops admins can fix parsing errors without developer intervention.
- RLS prevents cross-tenant data access.
- Monitoring, error logging, backups, and audit logs are active.
- Public launch pages are live.

---

## Phase 2

- Add all provincial, major department-specific, and additional newspaper tender sources.
- Add contractor JV and partner matching.
- Add contractor subcontracting opportunity workflows.
- Add award-history and competitor analysis.
- Add bid document assembly helpers.
- Add WhatsApp alerts.
- Add native mobile app after web usage validates demand.
- Add advanced self-hosted statistical models only where deterministic rules are insufficient and only when data remains on owned infrastructure.

---

## Non-Negotiable Product Rules

- The product must favor explainability over opaque predictions.
- The product must preserve evidence for extracted tender data.
- The product must route uncertainty to human QA.
- The product must keep customer documents private.
- The product must enforce tenant isolation at the database layer.
- The product must keep official portal URLs, newspaper source URLs, and raw snapshots for auditability.
- The product must never market automated checks as legal advice.
