# Daily Tender Alert Research Notes

Date checked: 2026-06-19  
Target: https://dailytenderalert.com/

## Scope and Limits

This report uses only lawful/authorized evidence: public pages, the subscribed account view available through the provided login, standard browser-visible HTML, headers, WordPress REST metadata, and normal account AJAX calls. It does not include bypassing access controls, extracting private server code, accessing admin-only areas, brute forcing, exploiting endpoints, or guessing secrets.

Server-side source code, database schema, cron jobs, scraper code, private AI prompts/models, and exact deduplication implementation are not exposed. Where this report describes those areas, it labels them as an inference.

## Executive Summary

Daily Tender Alert is a WordPress-based tender aggregation site running on Hostinger/LiteSpeed with custom PHP/WordPress functionality for tender listings, tender detail rendering, subscriber gating, PDF hosting, and alert filters.

The site publicly claims that it uses scraping, automation, AI-based image/PDF extraction, automated deduplication, categorization, validation, filtering, and indexing. The observed implementation confirms a server-side database of tender records, local copied tender PDFs under `/tender_files/`, source-name attribution per tender, generated tender detail pages, subscriber-only PDF iframe access, and account-level saved alert combinations stored via WordPress `admin-ajax.php`.

The exact persistence algorithm and extraction pipeline are not directly visible, but the exposed behavior strongly suggests:

- WordPress/PHP frontend with custom DTA functions/templates.
- Tenders stored outside normal WordPress public post types, likely in custom database tables or private custom storage.
- Tender detail route `/tender/{slug}/` maps to a single WordPress page template rather than individual public WordPress posts.
- Source PDFs are copied into local web-accessible storage as `/tender_files/tender_{source}_{id}.pdf`.
- Tenders are keyed by source-specific IDs or generated numeric IDs embedded in slugs and filenames.
- Subscriber access is handled server-side by WordPress login/session and subscription dates.

## Confirmed Platform and Tools

Confirmed from HTTP headers, HTML, REST metadata, and page source:

- Hosting/runtime: Hostinger/hPanel, LiteSpeed, PHP 8.2.30.
- CMS: WordPress 6.8.5.
- Theme: Astra 4.13.0.
- SEO/schema: Rank Math WordPress SEO.
- Analytics: Google Site Kit 1.166.0 / Google Analytics tag.
- Subscription/contact block: Hostinger Reach plugin.
- Icons/fonts: Font Awesome 6.5.2, Google Fonts, WordPress emoji assets.
- API layer: WordPress REST API and WordPress `admin-ajax.php`.
- Auth: native WordPress login cookies (`wordpress_logged_in_*`, `wordpress_sec_*`).
- Frontend tender pages: server-rendered HTML, inline CSS, inline JavaScript.

Site-claimed but not independently verifiable from client-side evidence:

- Advanced scraping systems.
- AI-powered image and PDF processing.
- AI models for extraction/classification.
- Automated deduplication logic.
- Smart categorization/classification.
- Dynamic search intelligence.

## Exposed Product Claims

The About page says the platform was built around public procurement data scattered across websites, portals, PDFs, and image advertisements. It explicitly claims:

- Advanced scraping from verified government sources.
- AI-powered image and PDF processing.
- Field extraction for title, tender number, dates, organization, city, province, category, and cost.
- Automated deduplication.
- Smart categorization into category, city, province, and organization.
- Real-time filtering.
- Dynamic search.
- Pipeline order: classification -> extraction -> validation -> filtering -> indexing.

The public tender listing claims the system updates multiple times daily, and the homepage claims every working day updates.

## Data Sources Observed

### Source Names Displayed on Tender Pages

Observed `Source Name` values from sampled tender detail pages:

- `Khyber Pakhtunkhwa PPRA`
- `SINDH PPRA`
- `PPRA`

These are confirmed from tender detail pages, not inferred.

### Source and Original URLs Observed

Observed source/original URLs and department URLs include:

- `https://eprocure.gov.pk/#/auth/login`
- `http://eprocure.gov.pk`
- `https://kp.eprocure.gov.pk`
- `http://kp.eprocure.gov.pk`
- `https://portalkp.eprocure.gov.pk`
- `https://portalsindh.eprocure.gov.pk`
- `https://portalsindh.eprocure.gov.pk/`
- `https://portalsindh.eprocure.gov.pk/#/`
- `http://www.pprasindh.gov.pk`
- `http://www.ppra.org.pk`
- `http://www.kppra.gov.pk`
- `http://kppr.s.gov.pk` / `https://kppr.s.gov.pk` as displayed on one page, likely a typo or bad extraction.
- Department/corporate URLs such as `www.sngpl.com.pk`, `www.pac.org.pk/tenders`, `www.piac.com.pk/corporate/sales-procurement/tender`, `www.phedkp.gov.pk`, `kpogcl.com.pk/tenders`, `sindhbank.com.pk`, `educationcity.gos.pk`, `tenders.iba.edu.pk`, `irrigation.gkp.pk`, and `lgkp.gov.pk`.

### Broader Source Inventory From 118 Extracted Detail Records

After the first pass, a broader legal/authenticated sample was taken across all-tender listing pages `1, 2, 3, 5, 10, 25, 50, 100, 200, 400, 600, 800, 1000, 1035`. This yielded 266 unique tender URLs. A paced detail extraction was stopped at 75 detail pages to avoid excessive traffic. Combined with earlier samples, the working dataset contained 118 extracted tender detail records.

Explicit `Source Name` values found in those 118 records:

| Source name | Sample count | Meaning |
|---|---:|---|
| `PPRA` | 58 | Federal/central PPRA-style tenders, including EPADS and department/corporate procurement pages |
| `Khyber Pakhtunkhwa PPRA` | 37 | KP procurement/e-procurement and KP department tenders |
| `SINDH PPRA` | 23 | Sindh PPRA/e-procurement and Sindh department tenders |

Observed source/original domains grouped by displayed source:

| Displayed source | Observed domains |
|---|---|
| `PPRA` | `vendors.epads.gov.pk`, `ppra.org.pk`, `eprocure.gov.pk`, `pac.org.pk`, `piac.com.pk`, `sngpl.com.pk`, `uog.edu.pk`, `quantum.org.pk`, `nbp.com.pk`, `pof.gov.pk`, `statelife.com.pk`, `peshawar.cantonment.gov.pk`, `fesco.com.pk`, `nha.gov.pk`, `procure.gov.pk`, `islamabadclub.org.pk`, `ebidding.pof.gov.pk`, `pakpost.gov.pk`, `pmdc.gov.pk`, `pitac.gov.pk` |
| `Khyber Pakhtunkhwa PPRA` | `kp.eprocure.gov.pk`, `eprocure.gov.pk`, `kppr.s.gov.pk`, `phedkp.gov.pk`, `portal.kppra.gov.pk`, `lgkp.gov.pk`, `epads.pprasindh.gov.pk`, `irrigation.gkp.pk`, `kppra.gov.pk`, `kth.edu.pk`, `kpogcl.com.pk`, `portalkp.eprocure.gov.pk`, `sbbwup.edu.pk`, `pkha.gov.pk` |
| `SINDH PPRA` | `pprasindh.gov.pk`, `portalsindh.eprocure.gov.pk`, `sindhbank.com.pk`, `educationcity.gos.pk`, `tenders.iba.edu.pk`, `uok.edu.pk`, `sindh.eprocure.gov.pk` |

Important interpretation:

- The exact explicit source taxonomy in their database appears coarse: only `PPRA`, `Khyber Pakhtunkhwa PPRA`, and `SINDH PPRA` appeared in the sampled detail pages.
- The practical acquisition sources are broader than those three labels because `Website` and `Original Source` fields point to EPADS, e-procurement portals, department websites, corporation websites, and university/cantonment/company tender pages.
- Some displayed source URLs are likely extraction mistakes or weak normalization, for example `kppr.s.gov.pk` and `epads.pprasindh.gov.pk` appearing under KP records.

Observed issuing-authority examples by displayed source:

| Displayed source | Issuing authorities observed |
|---|---|
| `PPRA` | Pakistan Navy, SNGPL, LESCO, Cantonment Board, PAC, PIA, Federal Government Educational Institutions Wah Region, University of Lakki Marwat, Ministry of Defence, NUST, FESCO, Pakistan Airports Authority, POF, NBP, WAPDA, Pakistan Post, Islamabad Club |
| `Khyber Pakhtunkhwa PPRA` | PHED, LG&RDD, Institute of Management Sciences Peshawar, Local Government District Shangla, Divisional Forest Officer Alpuri, TMA Mulkhow, C&W Department, Irrigation Department, Health Department, KPOGCL, Khyber Teaching Hospital |
| `SINDH PPRA` | Town Municipal Corporation Malir, Works & Services Department, Sindh Bank, KMC, Buildings Division, Education City, District & Sessions Court Tando Allahayar, Education Works Division, University of Karachi, IBA/NUST-related tender |

Observed local PDF prefixes from the combined sample:

| PDF filename prefix | Sample count | Meaning |
|---|---:|---|
| `tender_kppra_` | 28 | KP/KPPRA document copy |
| `tender_ppra2_` | 25 | PPRA/EPADS document copy |
| `tender_SINDH_` | 13 | Sindh PPRA document copy |

This is stronger evidence than the first pass: it shows a third local storage prefix, `tender_ppra2_`, for PPRA/EPADS documents.

### Issuing Authorities Observed

The site exposes a very large organization index. JSON-LD on `/tender-organizations/` says `numberOfItems: 2079`. These are issuing authorities, not necessarily scraper source adapters.

Examples observed in tender pages and organization listing:

- Sui Northern Gas Pipelines Limited (SNGPL)
- Sui Southern Gas Company Limited (SSGC)
- Pakistan Navy
- Pakistan Aeronautical Complex
- Pakistan International Airlines
- Pakistan Railways
- Khyber Pakhtunkhwa Oil & Gas Company Limited
- Local Government and Rural Development Department
- Public Health Engineering Department
- Town Municipal Corporation Malir
- Karachi Metropolitan Corporation
- Sindh Bank Limited
- National University of Sciences and Technology

## Sampled Tender Evidence

Current active sample:

| Source name | Issuing authority | Original/source URL behavior |
|---|---|---|
| Khyber Pakhtunkhwa PPRA | Local Government and Rural Development Department District Shangla | Website `kp.eprocure.gov.pk`; local PDF `tender_kppra_1781852741152.pdf` |
| Khyber Pakhtunkhwa PPRA | Khyber Pakhtunkhwa Oil & Gas Company Limited | Website `kpogcl.com.pk/tenders`; original source `eprocure.gov.pk/#/auth/login`; local PDF `tender_kppra_1781852711370.pdf` |
| SINDH PPRA | Sindh Bank Limited | Website `sindhbank.com.pk`; original source `portalsindh.eprocure.gov.pk/#/`; local PDF `tender_SINDH_1781852062536.pdf` |
| SINDH PPRA | Town Municipal Corporation Malir | Original source `pprasindh.gov.pk`; local PDF `tender_SINDH_*` |

Older/all-status sample:

| Source name | Issuing authority | Original/source URL behavior |
|---|---|---|
| PPRA | Pakistan Navy | Website/original `ppra.org.pk` |
| PPRA | Pakistan Aeronautical Complex | Website/original `pac.org.pk/tenders` |
| PPRA | Pakistan International Airlines | Website/original `piac.com.pk/corporate/sales-procurement/tender` |
| PPRA | SNGPL | Website `sngpl.com.pk`; original `eprocure.gov.pk` |
| PPRA | SSGC | No source URL visible in sampled row |
| Khyber Pakhtunkhwa PPRA | Health Department | Website `portalkp.eprocure.gov.pk` |
| SINDH PPRA | Education Works Division | Website/original `pprasindh.gov.pk` |
| SINDH PPRA | NUST / IBA Karachi item | Website `tenders.iba.edu.pk`; original `portalsindh.eprocure.gov.pk/` |

## How They Appear to Get Tender Data

Confirmed:

1. They maintain a central tender database, because listing pages, detail pages, counts, filters, and related tender cards all render from structured tender fields.
2. Each detail page displays source attribution through `Source Name`, `Website`, and sometimes `Original Source`.
3. They copy or cache tender PDFs locally under `/tender_files/`.
4. They categorize tender records by category, sector, tender type, city, province, organization, publish date, closing date, and created timestamp.
5. They generate SEO JSON-LD Article metadata for tender detail pages.

Likely ingestion flow inferred from exposed pages:

1. Fetch source listings from PPRA, KPPRA/KP e-procure, Sindh PPRA/e-procure, and department/corporate tender pages.
2. Download source tender documents/advertisements.
3. Store local PDF copies in `/tender_files/`.
4. Extract tender fields into a structured record.
5. Generate a slug from title plus source/reference IDs.
6. Deduplicate using source IDs, tender numbers, authority, title similarity, and closing dates.
7. Classify into category/city/province/organization.
8. Render the record through the shared `/tender/` WordPress page template.
9. Gate detailed PDF iframe/description content by WordPress login/subscription status.

More precise acquisition model after the broader sample:

```text
Source group: PPRA
  likely fetches from:
  - ppra.org.pk
  - eprocure.gov.pk / vendors.epads.gov.pk
  - selected department/corporate tender pages linked from PPRA or embedded in PPRA records
  local document prefix:
  - tender_ppra2_{epoch_ms}.pdf

Source group: Khyber Pakhtunkhwa PPRA
  likely fetches from:
  - kp.eprocure.gov.pk
  - portal.kppra.gov.pk / kppra.gov.pk
  - KP department websites when linked or referenced
  local document prefix:
  - tender_kppra_{epoch_ms}.pdf

Source group: SINDH PPRA
  likely fetches from:
  - pprasindh.gov.pk
  - portalsindh.eprocure.gov.pk
  - Sindh department/entity sites when linked or referenced
  local document prefix:
  - tender_SINDH_{epoch_ms}.pdf
```

What this implies operationally:

- They probably have at least three source adapters/importers: PPRA/EPADS, KPPRA/KP, and Sindh PPRA.
- The importer stores a coarse source label (`PPRA`, `Khyber Pakhtunkhwa PPRA`, `SINDH PPRA`) plus optional raw `website` and `original_source_url`.
- Department/entity websites are often not first-class source adapters; many appear to be link fields extracted from portal records or documents.
- The `ppra2` filename prefix suggests they may have had more than one PPRA importer version or a second-generation PPRA/EPADS importer.
- The system can ingest tenders even when no local PDF URL is visible, so a tender record can exist with metadata only.

Not verifiable:

- Which exact crawler framework they use.
- Whether scrapers are PHP, Python, Node, or external automation.
- Whether AI extraction is local or hosted.
- Which model/OCR provider is used.
- Exact duplicate thresholds or database constraints.
- Exact cron schedule.

## Data Persistence and Routing Analysis

### Confidence Statement

Their complete database schema and server-side algorithms are not externally visible. The model below is the deepest architecture reconstruction possible from normal public/subscriber access. Items marked "confirmed" were observed directly in headers, HTML, JSON, PDF responses, or account AJAX responses. Items marked "inferred" are the most likely implementation based on WordPress behavior and repeated page evidence.

### High-Level Persistence Architecture

Confirmed outer architecture:

```text
Source portals / department sites / source PDFs
        |
        v
Unexposed scraper/extraction process
        |
        +--> local PDF copy: /tender_files/tender_{source}_{epoch_ms}.pdf
        |
        v
WordPress-hosted MySQL/MariaDB persistence
        |
        +--> tender listing page: /tenders/?q=&category=&city=&province=&status=&organization=&closing_range=&cost_range=&page_num=
        +--> tender detail template: /tender/{slug}/
        +--> organization/category/city/province browse pages
        +--> account alert filters via /wp-admin/admin-ajax.php
```

Confirmed implementation traits:

- The visible app is not a static site. Counts and listings changed during inspection, for example the all-status count moved from `20683` to `20684` tenders.
- The tender listing page is WordPress page ID `157` (`Tenders In Pakistan`) and is dynamically rendered with custom tender data.
- The tender detail page is WordPress page ID `174` (`Tender details`) and is dynamically rendered based on the path after `/tender/`.
- A fake path such as `/tender/not-a-real-tender-0000/` still returns HTTP 200 and WordPress page ID `174`, then renders `Tender not found`.
- WordPress REST type discovery does not expose a `tender` custom post type. Exposed public types were standard WordPress types plus `rm_content_editor`.
- The sitemap index generated by Rank Math includes normal post/page/category sitemaps, not the tender detail URLs. This supports the conclusion that tenders are rendered from custom data, not public WordPress posts.

Inferred architecture:

- Tender records are likely stored in custom MySQL tables, not as regular `wp_posts`.
- The `/tender/{slug}/` route is likely a WordPress rewrite rule or page-template handler that reads the slug from the request and performs a custom DB lookup.
- Listing filters likely build SQL queries over a custom tender table, with joins or denormalized columns for category, city, province, and organization.
- The source document is saved before or during tender row creation, because file IDs precede `Created At` timestamps by seconds.

### Inferred Tender Table Shape

The following fields are visible repeatedly on listing/detail pages and therefore almost certainly exist as columns or derived fields in persistence:

```text
tenders
- id / internal numeric id
- slug
- title
- tender_no
- issuing_authority / organization_name
- category_names
- sector
- tender_type
- procurement_method
- submission_method
- estimated_cost
- source_name
- city
- province
- country
- publish_date
- closing_date
- created_at
- contact_person
- contact_phone
- contact_email
- website
- original_source_url
- tender_file_url / tender_file_path
- description
- status or computed active/expired state
```

Possible supporting tables or denormalized indexes:

```text
tender_categories or category terms
tender_cities or city dimension
tender_provinces or province dimension
tender_organizations
tender_sources
tender_documents
user_alert_combos
subscription/user meta
```

Evidence for denormalized filters:

- Listing filters are plain GET parameters: `q`, `category`, `city`, `province`, `status`, `organization`, `closing_range`, `cost_range`, and `page_num`.
- The table columns are `Title`, `Category`, `City`, `Province`, `Issuing Authority`, `Uploaded`, `Closing Date`, and `Details`.
- Account filter AJAX returns 7 provinces, 606 cities, and 55 categories.
- Organization listing JSON-LD reports 2,079 organizations.

### Listing Query Contract

Confirmed query parameters:

```text
/tenders/
  q=
  category=
  city=
  province=
  status=active | expired | all
  organization=
  closing_range=today | tomorrow | next3 | week | month
  cost_range=na | r1 | r2 | r3 | r4
  page_num=
```

Confirmed cost bucket labels:

- `na`: Cost Not Available
- `r1`: Under 10 Lac
- `r2`: 10 Lac - 50 Lac
- `r3`: 50 Lac - 1 Crore
- `r4`: 1 Crore+

Observed query behavior:

- `q=laptop` returned 99 tenders.
- `q=road` returned 1,143 tenders.
- `q=nonexistentzzzz` returned 0 tenders and a normal empty row.
- Active `Construction & Civil Works` returned 414 tenders at the time checked.
- All `Sindh` returned 6,829 tenders at the time checked.
- `closing_range=week` returned 479 tenders at the time checked.
- Requesting `page_num=1036` while the last page was `1035` still returned HTTP 200 with an empty result row.

Inference:

- They do not use REST/JSON for tender search from the browser; searches are server-rendered GET requests.
- Pagination is offset/page-number based, not cursor based.
- Active/expired status is likely computed from `closing_date` at query time or persisted as a status and refreshed.

### Document Persistence Details

Confirmed local document pattern:

```text
/tender_files/tender_kppra_1781852741152.pdf
/tender_files/tender_kppra_1781852711370.pdf
/tender_files/tender_SINDH_1781852062536.pdf
/tender_files/tender_ppra2_1781501818697.pdf
```

The `/tender_files/` directory itself returns 403 Forbidden, but individual known PDF URLs return HTTP 200. PDF responses include:

- `content-type: application/pdf`
- `server: LiteSpeed`
- `platform: hostinger`
- `x-robots-tag: noindex, nofollow`
- `last-modified`
- `etag`
- `content-length`

Important ID finding:

- The 13-digit IDs in PDF names decode as Unix epoch milliseconds.
- Example: `1781852741152` decodes to `2026-06-19T07:05:41.152Z`.
- The matching tender page showed `Created At: 2026-06-19 07:06:21`, 40 seconds later when both are treated as UTC-like server timestamps.
- Across sampled files, file ID time usually preceded `Created At` by roughly 14-58 seconds.

This strongly suggests the document filename is generated at fetch/download/save time, using something like a millisecond timestamp, and the tender row is inserted shortly after.

Sample PDF metadata confirms they preserve heterogeneous source documents:

- SINDH sample: Microsoft Word 2016 producer, 76 pages.
- KPPRA sample: CamScanner/intsig producer, 4 pages.
- Older KPPRA sample: WPS Writer creator, 2 pages.

Inference:

- They are not regenerating all tender PDFs from one internal renderer.
- The local PDF store is a public web directory with blocked directory listing, not signed/private object storage.
- The source document table, if present, likely stores at least `source_prefix`, `file_path`, `file_url`, `saved_at`, and maybe `content_length` or source URL.

### Slug and Identifier Model

Observed slug patterns:

```text
beautification-construction-model-streets-shangla-17818527-2379
procurement-05-laptops-579-2026-5046
acquiring-sms-services-whatsapp-1541-2026-7924
supply-paint-red-oxide-wil-pf-2025-26-4933
```

Inference:

- Slugs are generated from normalized title plus one or more source/reference fragments.
- The final 4-digit suffix looks like a collision-avoidance/random suffix.
- Some slugs include official tender numbers (`579-2026`, `WIL/PF/2025-26`), while others include source/time fragments (`17818527`).
- Slug uniqueness is probably enforced in the tender persistence layer.

### Account, Subscription, and Alert Persistence

Confirmed:

- Auth is native WordPress auth. Successful login created `wordpress_logged_in_*` and `wordpress_sec_*` cookies.
- Subscriber account page showed:
  - Name
  - Email
  - Username
  - WhatsApp/phone
  - Member since
  - Subscription plan name
  - Subscription start/end dates
  - Days used and remaining
- The sampled account had `Monthly Plan`, `15 Jun 2026 - 15 Jul 2026`.
- Account page supports 5 alert filter combinations.
- Alert filters are saved through `admin-ajax.php`.

Confirmed AJAX actions:

```text
dta_get_filter_options
dta_load_combo
dta_save_combo
dta_delete_combo
```

Confirmed AJAX behavior:

- `dta_get_filter_options` returns `{ success: true, data: { provinces, cities, categories } }`.
- `dta_load_combo` with an empty slot returns `{ success: true, data: { combo: null } }`.
- Bad nonce returns `-1`, standard WordPress nonce failure behavior.
- Missing action returns `0`, standard WordPress `admin-ajax.php` behavior.

Inference:

- Subscriptions are likely stored in WordPress user meta or a custom subscriber table keyed by WordPress user ID.
- Alert combinations are likely stored either as user meta JSON/serialized arrays or rows in a custom table keyed by `user_id` and `combo_number`.
- The daily alert job likely reads active subscribers, loads their 1-5 alert combinations, queries tender records by keyword/category/city/province, and sends email/WhatsApp/group alerts.

## Data Quality Observations

Observed data quality issues:

- City list includes duplicates/variants: `D.I. Khan`, `D.I.Khan`, `DI Khan`, `Dikhan`; `Gwadar`, `Gawadar`, `Gawadr`; `Jhelum`, `Jehlum`, `Jahelum`.
- City list includes international cities: London, Paris, Beijing, Singapore, Riyadh, New York, Toronto, etc.
- City list includes `null` as a selectable city.
- Some extracted URLs look malformed or suspicious, for example `kppr.s.gov.pk`.
- One sampled record had a closing date before publish date, suggesting imperfect extraction or old imported data.
- There is visible duplication in organization names, for example variants of ZTBL, women universities, and government departments.

These observations support the site's claim that it uses automated extraction, but they also show limited normalization/QA.

## Comparison Notes for TenderLo

Daily Tender Alert appears to be a broad tender aggregation/listing product. It does not visibly provide the deeper contractor-specific SaaS workflows required for TenderLo:

- No visible PEC-aware eligibility matching.
- No profile vault.
- No document readiness workflow.
- No evidence-backed field extraction UI.
- No human QA task workflow visible.
- No deterministic compliance engine visible.
- No tenant isolation or organization/team workflow visible to subscribers.
- No audit trail visible.

TenderLo should not copy their “AI extraction” positioning. TenderLo’s stronger defensible path is deterministic, evidence-backed, contractor-specific bid-readiness intelligence with source adapters, parser confidence, QA tasks, PEC/profile blockers, and private document storage.

## Sources Checked

- Homepage: https://dailytenderalert.com/
- Login page: https://dailytenderalert.com/login/
- About page: https://dailytenderalert.com/about-us/
- Subscribe page: https://dailytenderalert.com/subscribe/
- Tender listing: https://dailytenderalert.com/tenders/
- All-status tender listing: https://dailytenderalert.com/tenders/?status=all
- Organization listing: https://dailytenderalert.com/tender-organizations/
- WordPress REST index: https://dailytenderalert.com/wp-json/
- WordPress REST types: https://dailytenderalert.com/wp-json/wp/v2/types
- WordPress tender listing page object: https://dailytenderalert.com/wp-json/wp/v2/pages/157
- WordPress tender detail page object: https://dailytenderalert.com/wp-json/wp/v2/pages/174
- Account page: https://dailytenderalert.com/my-account/
- Authenticated AJAX endpoint: https://dailytenderalert.com/wp-admin/admin-ajax.php
- PDF folder path checked: https://dailytenderalert.com/tender_files/
- Robots file: https://dailytenderalert.com/robots.txt
- Sitemap index: https://dailytenderalert.com/sitemap_index.xml
- Sample tender page: https://dailytenderalert.com/tender/beautification-construction-model-streets-shangla-17818527-2379/
- Sample tender page: https://dailytenderalert.com/tender/procurement-05-laptops-579-2026-5046/
- Sample tender page: https://dailytenderalert.com/tender/acquiring-sms-services-whatsapp-1541-2026-7924/
