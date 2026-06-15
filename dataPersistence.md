# Pakistan Tender Intelligence SaaS – Implementation Plan  
**Focus: Data Pipeline and Persistence**

This plan provides the precise steps to build the core data pipeline and persistence layer for the Pakistan Tender Intelligence platform. It is designed to be directly executable by an agentic AI system following the specifications in `CONTEXT.md`, `AGENTS.md`, and the architecture diagrams.

---

## 1. System Architecture Overview

The platform is a monorepo with two main applications and several shared packages. The data pipeline runs as a worker service (`apps/worker`) while the web app (`apps/web`) provides the user interface and API.

- **Database:** Supabase PostgreSQL – used for all persistent structured data.
- **Storage:** Supabase Storage – private buckets for tender documents, raw snapshots, company profile documents.
- **Auth:** Supabase Auth – with user profiles extended by `profiles` table.
- **RLS:** Row‑Level Security on all tenant‑owned tables to enforce organisation isolation.

The pipeline components are isolated in packages:
- `packages/sources` – adapters for each tender source (portals, departments, newspapers)
- `packages/parsing` – local PDF, DOCX, HTML, and Tesseract OCR utilities
- `packages/intelligence` – deterministic field extraction, classification, deduplication
- `packages/scoring` – RECON recommendation engine, compliance checks
- `packages/notifications` – email/WhatsApp alert delivery
- `packages/db` – migrations, seeds, generated types, RLS policies
- `packages/shared` – Zod schemas, constants, enums

### 1.1 Current Implementation Status

As of 2026-05-05, the current repository implements the persistence foundation in `packages/db/migrations/0001_initial_schema.sql`, mirrored at `supabase/migrations/0001_initial_schema.sql`. It includes the core tables, RLS enablement, ops-admin RLS policies, private storage buckets, seed data, extracted-field evidence storage, verified-field protection, QA task helpers, and worker persistence for raw snapshots, documents, parsed text, extracted fields, sector matches, duplicates, recommendations, compliance checks, notifications, and audit logs.

---

## 2. Data Persistence Strategy

Data persistence is the backbone of the system. Every fact must be stored with provenance, evidence, and auditability.

### 2.1 Database Schema (Core Tables)

All tables must be created via migrations in `packages/db/migrations`. The following tables are critical for the data pipeline:

| Table                   | Purpose                                                     |
|------------------------|-------------------------------------------------------------|
| `organizations`         | Tenant workspace for each contractor company                |
| `memberships`           | Links users to organisations with roles (`owner`, `admin`, …) |
| `tender_sources`        | Registered ingestion sources (federal, provincial, newspaper)|
| `ingestion_runs`        | Log of every source fetch attempt (status, counts, errors)   |
| `raw_source_snapshots`  | Raw HTML/PDF/image blobs stored in Storage; metadata here    |
| `tenders`               | Normalised, deduplicated tender records                     |
| `tender_documents`      | Attachments downloaded from sources; stored in private buckets|
| `parsed_document_text`  | Extracted text per page, with method and confidence         |
| `extracted_fields`      | Each individual field (e.g., closing date) with evidence and confidence|
| `field_extraction_rules`| Rule definitions (regex, keyword windows) used by intelligence|
| `tender_sector_matches` | Classified sectors with scores and matched keywords         |
| `duplicate_candidates`  | Potential duplicates pending QA                             |
| `recommendations`       | Scored suggestions per organisation per tender              |
| `compliance_checks`     | Results of pre‑bid eligibility checks                       |
| `qa_tasks`              | Work items for low‑confidence extraction, duplicates, failures|
| `audit_logs`            | Immutable record of all admin and system changes             |
| `profile_documents`     | Uploaded contractor documents (PEC license, financials, etc.)|
| `pec_licenses`          | PEC category records                                        |
| `engineers`, `equipment`| Profile Vault data                                          |

**Critical columns for data integrity:**
- `extraction_confidence` on `tenders`
- `evidence_text`, `source_method`, `confidence_score`, `verification_status` on `extracted_fields`
- `content_hash` on `raw_source_snapshots` and `tender_documents` for dedup
- `is_human_verified` flag on `tenders`

### 2.2 Storage Buckets

Three private buckets in Supabase Storage:

| Bucket                          | Contents                                      | Access                  |
|---------------------------------|-----------------------------------------------|-------------------------|
| `tender-source-snapshots`       | Original scraped HTML, PDFs, images           | Admin only via signed URLs |
| `tender-documents`              | Downloaded tender attachments                 | Signed URLs valid for few hours |
| `profile-documents`             | Company‑uploaded PEC licences, audit reports  | Organisation‑specific RLS |

Profile documents are stored under `{organization_id}/profile-documents/{uuid}-{filename}`. Tender source snapshots are stored under `{source_id}/{ingestion_run_id}/{content_hash}.{ext}`. Tender documents are stored under `{tender_id}/{content_hash}-{filename}`. Signed URLs are generated server‑side when a user requests a permitted download.

### 2.3 Row‑Level Security (RLS)

Supabase RLS policies must enforce:
- An `ops_admin` can read/write any row (for administrative purposes).
- For `tenders` table: public can see published tenders (if plan allows), authenticated users can see full details based on plan gating, modifications only by `ops_admin` or the system.
- For organisation‑owned tables (`organizations`, `company_profiles`, `profile_documents`, `pec_licenses`, `recommendations`, `compliance_checks`, etc.): a user can only access rows where `organization_id` equals their current membership organisation.
- Service role (worker) bypasses RLS; must be used carefully only in backend jobs.

RLS policies are defined in the database migration files under `packages/db/migrations` and mirrored under `supabase/migrations`.

### 2.4 Evidence and Audit Trail

- Every `extracted_fields` row stores `evidence_text` (the text snippet that was matched) and `source_method`.
- Human‑verified fields get `verification_status = verified` and are never overwritten by automated runs.
- Human‑verified tender rows set `is_human_verified = true`; automated ingestion reuses the existing row instead of overwriting its normalized tender fields.
- Repeated automated extractions are deduped by tender, optional document, field name, field value, method, and evidence hash.
- All admin edits are logged to `audit_logs` with old/new values.
- `raw_source_snapshots` preserve exact adapter-provided fetched content when available, enabling future reprocessing. The generic HTML adapters pass the raw detail HTML into the worker for storage.

---

## 3. Data Pipeline Design

The pipeline is the heart of the system. It runs as a scheduled worker job (`POST /api/worker/ingest-source` for a specific source, or a batch job `ingest-all`).

### 3.1 Pipeline Steps (Logical Flow)

1. **Retrieve Active Sources** – from `tender_sources` where `status = active` and `scrape_frequency_minutes` elapsed.
2. **Start `ingestion_runs` Record** – mark status `running`.
3. **Source‑Specific Fetch** – call the adapter’s `fetchTenders(context)`.
   - Adapters respect rate limits (configurable delay between requests).
   - Fail gracefully: on error, record failure, increment `consecutive_failures`, and if threshold exceeded, disable source and create QA task.
4. **Store Raw Snapshots** – for every fetched listing page/detail URL, save the raw content (HTML/PDF/image) to `tender-source-snapshots` bucket, record metadata in `raw_source_snapshots`.
5. **Parse Listings to Tender URLs** – adapter extracts candidate tender detail URLs and metadata.
6. **Fetch Detail Pages** – rate‑limited, store snapshots.
7. **Download Attachments** – from tender detail pages, save to `tender-documents` bucket, create `tender_documents` rows.
8. **Document Parsing** (see 3.2).
9. **Field Extraction** (see 3.3).
10. **Sector Classification** (see 3.4).
11. **Deduplication** (see 3.5).
12. **Publish or Route to QA** – if overall confidence is acceptable (e.g., closing date certainty ≥ 90%), create/update `tenders` with status `published`; otherwise status `draft` or `under_review` and create `qa_tasks`.
13. **Rebuild Recommendations** – for all organisations where the new tender could apply, run scoring and update `recommendations`.
14. **Send Alerts** – match against saved searches and recommendation thresholds, create `notifications` and dispatch via configured channel.
15. **Complete `ingestion_runs`** – set status to `succeeded` (or `partial` if some steps had soft failures) and record counts.

### 3.2 Document Parsing Sub-Pipeline

For each `tender_documents` row where `parser_status = pending`:

1. Determine MIME type.
2. Use local parser:
   - **PDF:** `pdf-parse` or `pdfjs-dist` to extract text.
   - **DOCX:** `mammoth` or `docx-parser`.
   - **HTML:** Cheerio with source‑specific selectors.
3. If text extraction yields less than 100 characters per page (or page is image‑based), trigger local Tesseract OCR on the page image.
4. Store text chunks in `parsed_document_text` with `extraction_method` and `confidence_score` (for OCR, confidence from Tesseract).
5. If parsing completely fails, set `parser_status = failed` and create a `qa_tasks` record. Otherwise, set to `parsed`.

### 3.3 Field Extraction

Run after document text is available. The intelligence engine (`packages/intelligence`) loads applicable `field_extraction_rules` for the source adapter.

- **Date detection:** regex patterns for various Pakistani date formats (DD‑MM‑YYYY, DD/MM/YYYY, etc.), augmented with keyword windows (`closing date`, `submission deadline`).
- **Money values:** patterns like `Rs. 5,00,000`, `PKR 1.2 billion`, `5 lac`, `10 million`.
- **Bid security:** proximity of `bid security`, `earnest money`, `call deposit` to a money value.
- **PEC categories:** regex for `C‑A`, `C‑B`, `C‑1`..`C‑6`.
- **Department & location:** gazetteer‑based dictionary matching.
- For each candidate field, calculate a `confidence_score` based on rule weight, evidence quality, and cross‑validation.
- Save every extraction to `extracted_fields` with `evidence_text`. If confidence is below a configurable threshold (e.g., 0.7), flag as `needs_review` and create a QA task.
- Populate the `tenders` row with the best extracted values.

### 3.4 Sector Classification

Using `tender_sector_matches`:

- Apply weighted keyword matching against a dictionary for each contractor sector (construction, roads, electrical, etc.).
- Title keywords get double weight compared to body text.
- Assign primary sector with highest score; store secondary matches.
- If no sector reaches minimum confidence, mark as `uncategorized` and create QA task.

### 3.5 Deduplication

Compares new/extracted tender with existing ones:

- Exact match on `source_url` and `tender_number` → automatic merge (update existing).
- High‑confidence match on normalised title + department + closing date (+‑2 days) → merge.
- Medium confidence → create `duplicate_candidates` record with `status = pending`, assign to QA.
- Low confidence → keep separate.

### 3.6 Quality Assurance (QA) Tasks

Throughout the pipeline, whenever uncertainty is high, a `qa_tasks` row is created with appropriate `task_type` (e.g., `low_confidence_field`, `duplicate_review`, `source_failure`, `parser_failure`). These are resolved by an `ops_admin` via the admin dashboard, which updates the associated tender or field.

### 3.7 Recommendation & Compliance

Scoring and compliance checks are separate jobs that can be triggered by new tender publication or profile changes. They read from the profile vault and tender data, and write to `recommendations` and `compliance_checks` tables. This logic is deterministic and evidence‑backed.

---

## 4. Worker Service Implementation

The worker (`apps/worker`) is a Node.js application that can be run as a cron job or triggered via HTTP endpoints. It imports all pipeline logic from the packages.

**Key entry points:**

- `npm run worker -- ingest-source <source-id>` – run ingestion for a single source.
- `npm run worker -- ingest-all` – run for all due sources.
- `npm run worker -- rebuild-recommendations [organization-id]` – forced rebuild.
- `npm run worker -- send-alerts` – process pending notifications.
- `npm run worker -- close-expired` – close published tenders past their closing date.
- `npm run worker -- schedule` – run scheduled ingestion, alerts, and closure jobs.

The worker must use Supabase service role key to bypass RLS for system operations. It should be idempotent: repeated runs for the same source should not create duplicate tenders or send duplicate notifications.

**Idempotency mechanisms:**
- Deduplicate before publishing (same source URL + tender number).
- Check for existing `ingestion_runs` with same source and timestamp to avoid concurrent runs.
- Use content hash of snapshots to skip unchanged detail pages.
- Reuse open QA tasks for the same organization/source/tender/type/title instead of creating repeated work items.
- Check existing saved-search and recommendation notifications before creating new alerts for the same tender/channel.

---

## 5. Implementation Roadmap

The build order is critical to ensure the data pipeline and persistence work early. Follow this sequence.

### Phase 1: Foundation (Weeks 1–2)
- **Monorepo setup** with npm workspaces.
- **Database**:
  - Create all tables via migrations (packages/db).
  - Write RLS policies.
  - Seed initial data: `tender_sources` (at least Federal PPRA), `field_extraction_rules` (basic set), and a test organisation with ops_admin user.
- **Auth & Organisations**: Implement sign‑up/login, onboarding, organisation creation, role management (server actions, API routes).

### Phase 2: Profile Vault (Week 3)
- **API routes** for company profile, PEC licenses, engineers, documents upload.
- **Storage** bucket `profile-documents` and RLS for organisation isolation.
- **Frontend** (web) to complete profile.
- At this point, a contractor can create their company profile; persistence is proven.

### Phase 3: Manual Tender Entry (Week 4)
- Admin API for creating/editing tenders (`POST /api/admin/tenders`).
- Allows testing tender search and basic display even before automated ingestion.
- **Search API**: `GET /api/tenders` uses the generated `search_document` tsvector, validates filters through `tenderSearchSchema`, supports URL-shareable filters and pagination, forces published-only results for non-ops users, and strips value/security/document fields from free/public responses.
- **Search indexes**: maintain indexes for status/source/closing date, province/city, sector, department trigram search, estimated value, bid security, PEC extracted fields, and recommendation score/status.

### Phase 4: First Source Adapter & Ingestion Worker (Weeks 5–6)
- **Implement Federal PPRA/EPADS adapter** in `packages/sources`. Use `fetch` with rate limiting.
- **Ingestion worker** that calls the adapter, stores snapshots, parses HTML details, extracts fields using simple rules, and creates tender rows.
- **Document download** and local parsing (PDF, HTML). Implement OCR only if needed (start with text PDFs).
- **Field extraction** with a few critical fields (closing date, department, estimated value).
- **QA task creation** for low confidence.
- At this milestone, the pipeline is end‑to‑end for one source, and tenders appear in the database.

### Phase 5: Newspaper Adapter & OCR (Week 7)
- Add one newspaper source (e.g., Dawn tenders public page) as a separate adapter. Implement image fetching, Tesseract OCR integration.
- Ensure newspaper provenance is stored (publication date, newspaper name).
- Test OCR field extraction; route low confidence to QA.

### Phase 6: Deduplication, Classification, and QA Dashboard (Week 8)
- Build sector classification with keyword dictionaries.
- Implement deduplication logic and `duplicate_candidates` table.
- Admin QA dashboard to resolve tasks, verify fields, merge duplicates.
- **User search UI** with filters.

### Phase 7: Recommendations & Compliance (Week 9)
- RECON scoring engine: load profile and tender data, apply blockers, calculate scores.
- Compliance check API: compare tender requirements against profile data.
- Frontend to display recommendations and compliance reports.

### Phase 8: Alerts, Billing, and Polish (Week 10–12)
- Saved searches and notification rules; worker to send alerts.
- PayFast integration and plan gating.
- Full audit logs, monitoring, and data quality checks.
- Public pages, SEO, and launch preparation.

---

## 6. Key Integration Points & Contracts

- **Source Adapter Interface:** Each adapter implements `fetchTenders(context): Promise<RawTenderPayload[]>`. `RawTenderPayload` is defined in `packages/shared` and may include `rawSnapshot` content for exact source snapshot storage.
- **Parser Output:** Text extraction functions return `{ text: string, method: 'pdf_text' | 'ocr', confidence: number }[]`.
- **Extraction Rules:** Stored in database; loaded by intelligence engine. Rules can be edited via admin API without code changes.
- **Storage Path Conventions:** Profile document paths start with the organization ID for RLS checks. Tender source snapshots use source/run/hash paths. Tender documents use tender/hash paths because public tenders are not tenant-owned.
- **Error Handling:** Every pipeline component wraps operations in try/catch, logs errors, updates run status, and creates QA tasks for unrecoverable failures. The worker must never crash due to one broken source.

---

## 7. Testing the Data Pipeline

- **Unit tests:** for parsers, extraction rules, classification, dedup scoring.
- **Integration tests:** seed an organisation and a source, trigger ingestion, verify tenders appear, documents are parsed, fields are extracted, QA tasks created when expected.
- **Idempotency test:** run same source twice, ensure no duplicate tenders, ingestion run counts are correct.
- **RLS test:** attempt to access another organisation’s documents via API – must be denied.
- **End‑to‑end:** simulate full user journey – signup, profile completion, ingestion run, search, compliance check.

**Data Quality Gates** (from `CONTEXT.md`): Before launch, manually verify 100 tenders and achieve accuracy targets on closing dates, department, bid security, city, and sector classification. Fields below target remain in QA mode.

---

## 8. Conclusion

This implementation plan provides a step‑by‑step, dependency‑ordered path to building the Pakistan Tender Intelligence platform with a fully functional data pipeline and robust persistence. By following the architecture diagrams, API contracts, and the incremental roadmap, an agentic AI can construct a system that ingests official and newspaper tender notices, processes documents locally, extracts fields with evidence, enforces quality through QA, and serves reliable compliance‑aware recommendations to Pakistani contractors.

The plan respects all hard rules from `AGENTS.md`: deterministic intelligence, evidence‑backed extraction, tenant isolation, and strict separation of concerns. The final product will be a sellable SaaS that contractors trust.
