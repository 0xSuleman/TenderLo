# Pakistan Tender Intelligence SaaS - Elaboration Diagrams

This file contains implementation-oriented diagrams for the Pakistan Tender Intelligence SaaS. Use these diagrams alongside `CONTEXT.md`, `AGENTS.md`, and `se-principles.md` when building or reviewing the system.

All diagrams use Mermaid syntax.

---

## 1. System Context Diagram

Shows the product boundary, contractor-side actors, tender data sources, and payment/notification dependencies.

```mermaid
flowchart LR
    contractor["Contractor User"]
    staff["Contractor Staff"]
    owner["Contractor Owner"]
    admin["Contractor Admin"]
    ops["Internal Ops Admin"]

    app["Pakistan Tender Intelligence SaaS"]

    ppra["Federal PPRA / EPADS"]
    punjab["Punjab PPRA"]
    sindh["Sindh PPRA"]
    kp["KP PPRA"]
    balochistan["Balochistan PPRA"]
    dept["Department Tender Sites"]
    newspapers["Free Pakistani Newspaper Tender Notices"]

    payfast["PayFast"]
    email["Email Provider"]
    whatsapp["WhatsApp Provider Adapter"]

    contractor --> app
    staff --> app
    owner --> app
    admin --> app
    ops --> app

    app --> ppra
    app --> punjab
    app --> sindh
    app --> kp
    app --> balochistan
    app --> dept
    app --> newspapers

    app --> payfast
    app --> email
    app -. "phase 2 / provider configured" .-> whatsapp
```

---

## 2. Container Architecture Diagram

Shows the major deployable units and shared infrastructure.

```mermaid
flowchart TB
    subgraph Browser["User Browser"]
        ui["Next.js UI"]
    end

    subgraph Web["apps/web"]
        appRouter["App Router Pages"]
        apiRoutes["API Routes"]
        serverActions["Server Actions"]
        authMiddleware["Auth / Role Middleware"]
    end

    subgraph Worker["apps/worker"]
        scheduler["Scheduler"]
        ingestion["Ingestion Jobs"]
        parsingJobs["Parsing / OCR Jobs"]
        scoringJobs["Recommendation Jobs"]
        alertJobs["Alert Jobs"]
    end

    subgraph Packages["Shared Packages"]
        dbPkg["packages/db"]
        sourcesPkg["packages/sources"]
        parsingPkg["packages/parsing"]
        intelPkg["packages/intelligence"]
        scoringPkg["packages/scoring"]
        notificationsPkg["packages/notifications"]
        sharedPkg["packages/shared"]
    end

    subgraph Supabase["Supabase"]
        auth["Auth"]
        postgres["Postgres + RLS"]
        storage["Private Storage Buckets"]
    end

    browserUser["Users"] --> ui
    ui --> appRouter
    appRouter --> apiRoutes
    appRouter --> serverActions
    apiRoutes --> authMiddleware
    serverActions --> authMiddleware

    authMiddleware --> auth
    authMiddleware --> postgres
    apiRoutes --> storage

    scheduler --> ingestion
    ingestion --> sourcesPkg
    ingestion --> dbPkg
    ingestion --> storage
    parsingJobs --> parsingPkg
    parsingJobs --> intelPkg
    scoringJobs --> scoringPkg
    alertJobs --> notificationsPkg

    dbPkg --> postgres
    parsingPkg --> storage
    intelPkg --> postgres
    scoringPkg --> postgres
    notificationsPkg --> postgres

    Web --> Packages
    Worker --> Packages
```

---

## 3. Monorepo Dependency Diagram

Shows intended package dependencies. Keep dependencies pointed inward toward shared contracts, not sideways into unrelated modules.

```mermaid
flowchart TD
    web["apps/web"]
    worker["apps/worker"]

    db["packages/db"]
    sources["packages/sources"]
    parsing["packages/parsing"]
    intelligence["packages/intelligence"]
    scoring["packages/scoring"]
    notifications["packages/notifications"]
    shared["packages/shared"]

    web --> shared
    web --> db
    web --> scoring
    web --> notifications

    worker --> shared
    worker --> db
    worker --> sources
    worker --> parsing
    worker --> intelligence
    worker --> scoring
    worker --> notifications

    sources --> shared
    parsing --> shared
    intelligence --> shared
    intelligence --> parsing
    scoring --> shared
    scoring --> db
    notifications --> shared
    notifications --> db
    db --> shared
```

---

## 4. High-Level Data Flow Diagram

Shows how tender data moves from portals, department pages, and newspapers to contractor users.

```mermaid
flowchart LR
    sources["Portals, Departments, Newspapers"]
    fetch["Fetch With Rate Limits"]
    snapshot["Store Raw Snapshot in tender-source-snapshots"]
    parseList["Parse Listing / Detail"]
    docs["Download Documents"]
    parseDocs["Local Parsing / OCR"]
    extract["Rule-Based Field Extraction"]
    classify["Sector Classification"]
    dedupe["Deduplication"]
    qa{"Needs QA?"}
    publish["Publish Tender"]
    score["Rebuild Recommendations"]
    alerts["Send Alerts"]
    users["Users"]

    sources --> fetch
    fetch --> snapshot
    snapshot --> parseList
    parseList --> docs
    docs --> parseDocs
    parseDocs --> extract
    extract --> classify
    classify --> dedupe
    dedupe --> qa
    qa -- "yes" --> qaTasks["Create QA Task"]
    qaTasks --> ops["Ops Review"]
    ops --> publish
    qa -- "no" --> publish
    publish --> score
    score --> alerts
    alerts --> users
```

---

## 5. Tender Ingestion Sequence Diagram

Shows a single source ingestion run from scheduler to database.

```mermaid
sequenceDiagram
    participant Scheduler
    participant Worker
    participant SourceAdapter
    participant Storage
    participant Parser
    participant Intelligence
    participant Database
    participant QA

    Scheduler->>Worker: Start ingestion for active source
    Worker->>Database: Create ingestion_runs record
    Worker->>SourceAdapter: Fetch listing pages
    SourceAdapter-->>Worker: Raw listing payloads
    Worker->>Storage: Store raw source snapshots in tender-source-snapshots
    Worker->>SourceAdapter: Parse listing and detail URLs
    SourceAdapter-->>Worker: Normalized raw tender payloads
    Worker->>Storage: Download and store attachments
    Worker->>Parser: Extract text from documents
    Parser-->>Worker: Parsed text and parser status
    Worker->>Intelligence: Extract fields and classify tender
    Intelligence-->>Worker: Fields, evidence, confidence, sector
    Worker->>Database: Upsert tender and extracted fields
    Worker->>Database: Run duplicate detection
    alt low confidence or ambiguous duplicate
        Worker->>QA: Create qa_tasks record
    else acceptable confidence
        Worker->>Database: Publish or update tender
    end
    Worker->>Database: Complete ingestion_runs record
```

---

## 6. Local Document Parsing Pipeline

Shows deterministic local parsing behavior without hosted document intelligence.

```mermaid
flowchart TD
    doc["Tender Document"]
    type{"Document Type"}
    html["HTML Extractor"]
    pdf["PDF Text Extractor"]
    docx["DOCX Text Extractor"]
    image["Image / Scanned PDF"]
    textCheck{"Text Extracted?"}
    ocr["Local Tesseract OCR"]
    clean["Text Cleanup / Normalization"]
    pageStore["Store parsed_document_text"]
    fail["Create Parser Failure QA Task"]

    doc --> type
    type -- "HTML" --> html
    type -- "PDF" --> pdf
    type -- "DOCX" --> docx
    type -- "image or scanned page" --> image
    image --> ocr
    html --> textCheck
    pdf --> textCheck
    docx --> textCheck
    textCheck -- "yes" --> clean
    textCheck -- "no" --> ocr
    ocr --> clean
    ocr -- "failed" --> fail
    clean --> pageStore
```

---

## 7. Newspaper Tender Source Pipeline

Shows how free public Pakistani newspaper tender notices are handled as first-class sources.

```mermaid
flowchart TD
    newspaper["Public Newspaper / E-Paper Source"]
    access{"Publicly Accessible?"}
    skip["Skip Source / Do Not Bypass Controls"]
    fetch["Fetch Tender Page / Classified Page"]
    snapshot["Store Source Snapshot"]
    noticeType{"Notice Format"}
    html["Parse HTML Text"]
    pdf["Parse E-Paper PDF"]
    image["Store Notice Image / Clipping"]
    ocr["Run Local Tesseract OCR"]
    extract["Extract Tender Fields"]
    provenance["Attach Newspaper Name, Publication Date, Page/Section, URL"]
    confidence{"Confidence Acceptable?"}
    qa["Create Newspaper Notice QA Task"]
    publish["Publish Contractor-Relevant Tender"]

    newspaper --> access
    access -- "no, login/paywall/CAPTCHA/prohibited" --> skip
    access -- "yes" --> fetch
    fetch --> snapshot
    snapshot --> noticeType
    noticeType -- "HTML" --> html
    noticeType -- "PDF" --> pdf
    noticeType -- "image/clipping" --> image
    pdf --> ocr
    image --> ocr
    html --> extract
    ocr --> extract
    extract --> provenance
    provenance --> confidence
    confidence -- "no" --> qa
    qa --> publish
    confidence -- "yes" --> publish
```

---

## 8. Field Extraction Decision Flow

Shows how a tender fact is extracted, scored, and routed to QA if uncertain.

```mermaid
flowchart TD
    parsedText["Parsed Text / HTML"]
    sourceRules["Source-Specific Selectors"]
    regexRules["Regex Rules"]
    keywordRules["Keyword Window Rules"]
    tableRules["Table Rules"]
    dictionaryRules["Dictionary Rules"]

    candidates["Candidate Field Values"]
    normalize["Normalize Value"]
    confidence["Calculate Confidence"]
    evidence["Attach Evidence Text"]
    threshold{"Confidence >= Threshold?"}
    verified{"Human Verified Field Exists?"}
    save["Save deduped extracted_fields"]
    qa["Create Low-Confidence QA Task"]
    protect["Keep Human-Verified Value"]
    protectTender["Keep Human-Verified Tender Row"]

    parsedText --> sourceRules
    parsedText --> regexRules
    parsedText --> keywordRules
    parsedText --> tableRules
    parsedText --> dictionaryRules

    sourceRules --> candidates
    regexRules --> candidates
    keywordRules --> candidates
    tableRules --> candidates
    dictionaryRules --> candidates

    candidates --> normalize
    normalize --> confidence
    confidence --> evidence
    evidence --> verified
    verified -- "yes" --> protect
    verified -- "no" --> threshold
    threshold -- "yes" --> save
    threshold -- "no" --> qa
    qa --> save
    protect --> protectTender
```

---

## 9. Recommendation and Compliance Flow

Shows how company profile data and tender data produce explainable outputs.

```mermaid
flowchart TB
    profile["Company Profile Vault"]
    pec["PEC License / Category / Codes"]
    docs["Profile Documents"]
    engineers["Engineers"]
    equipment["Equipment"]
    tender["Tender + Extracted Requirements"]

    blockers["Hard Blocker Checks"]
    score["RECON Score"]
    compliance["Compliance Check"]
    rec["Recommendation Record"]
    report["Printable Compliance Report"]

    profile --> pec
    profile --> docs
    profile --> engineers
    profile --> equipment

    pec --> blockers
    docs --> blockers
    engineers --> blockers
    equipment --> blockers
    tender --> blockers

    blockers --> decision{"Blocked?"}
    decision -- "yes" --> recBlocked["Recommendation: blocked"]
    decision -- "no" --> score

    score --> rec
    blockers --> compliance
    score --> compliance
    compliance --> report
```

---

## 10. RECON Scoring Breakdown

Shows scoring factors and weights.

```mermaid
pie title RECON Recommendation Score Weights
    "PEC and Value Eligibility" : 35
    "Sector and Specialization Match" : 25
    "Geography Match" : 15
    "Document Readiness" : 15
    "Deadline Preparation Window" : 10
```

---

## 11. Entity Relationship Diagram

Shows the primary database entities and relationships.

```mermaid
erDiagram
    organizations ||--o{ memberships : has
    profiles ||--o{ memberships : joins
    organizations ||--|| company_profiles : owns
    organizations ||--o{ pec_licenses : has
    organizations ||--o{ engineers : has
    organizations ||--o{ equipment : has
    organizations ||--o{ profile_documents : stores
    organizations ||--o{ recommendations : receives
    organizations ||--o{ compliance_checks : runs
    organizations ||--o{ saved_searches : creates
    organizations ||--o{ notification_rules : configures
    organizations ||--o{ subscriptions : pays_for
    organizations ||--o{ audit_logs : produces

    tender_sources ||--o{ ingestion_runs : runs
    tender_sources ||--o{ raw_source_snapshots : snapshots
    tender_sources ||--o{ tenders : publishes

    tenders ||--o{ tender_documents : has
    tender_documents ||--o{ parsed_document_text : contains
    tenders ||--o{ extracted_fields : has
    tenders ||--o{ tender_sector_matches : classified_as
    tenders ||--o{ duplicate_candidates : compared_with
    tenders ||--o{ recommendations : scored_for
    tenders ||--o{ compliance_checks : checked_against
    tenders ||--o{ notifications : referenced_by

    saved_searches ||--o{ notification_rules : drives
    subscriptions ||--o{ payments : receives
    subscriptions ||--o{ invoices : issues
```

---

## 12. Tenant Isolation and Authorization Flow

Shows the intended security boundary for organization-owned data.

```mermaid
flowchart TD
    request["Authenticated Request"]
    session["Supabase Session"]
    membership["Load Membership"]
    role{"Allowed Role?"}
    rls["Supabase RLS Policy"]
    data["Organization-Owned Data"]
    deny["Deny Request"]
    audit["Write Audit Log If Mutating"]

    request --> session
    session --> membership
    membership --> role
    role -- "no" --> deny
    role -- "yes" --> rls
    rls -- "denied" --> deny
    rls -- "allowed" --> data
    data --> audit
```

---

## 13. User Onboarding Flow

Shows the first-run experience for a new organization.

```mermaid
flowchart TD
    signup["Signup"]
    confirm{"Supabase Session Created?"}
    login["Login"]
    membership{"Active Membership?"}
    createOrg["Create Organization"]
    companyBasics["Company Basics"]
    pec["PEC License"]
    docs["Upload Key Documents"]
    preferences["Tender Preferences"]
    dashboard["Dashboard"]

    signup --> confirm
    confirm -- "no, email confirmation required" --> login
    confirm -- "yes" --> membership
    login --> membership
    membership -- "yes" --> dashboard
    membership -- "no" --> createOrg
    createOrg --> companyBasics
    companyBasics --> pec
    pec --> docs
    docs --> preferences
    preferences --> dashboard
```

---

## 14. Authenticated Navigation Map

Shows primary app navigation and expected feature grouping.

```mermaid
flowchart TD
    app["Authenticated App Shell"]
    dashboard["Dashboard"]
    tenders["Tender Search"]
    tenderDetail["Tender Detail"]
    recommendations["Recommendations"]
    compliance["Compliance Reports"]
    profile["Profile Vault"]
    docs["Document Manager"]
    alerts["Saved Searches / Alerts"]
    billing["Billing"]
    team["Team Settings"]
    account["Account Settings"]

    app --> dashboard
    app --> tenders
    tenders --> tenderDetail
    tenderDetail --> compliance
    app --> recommendations
    recommendations --> tenderDetail
    app --> profile
    profile --> docs
    app --> alerts
    app --> billing
    app --> team
    app --> account
```

---

## 15. Public Site Navigation Map

Shows public pages and conversion paths.

```mermaid
flowchart TD
    home["Home"]
    pricing["Pricing"]
    preview["Public Tender Preview"]
    seoProvince["Province SEO Pages"]
    seoCategory["Category SEO Pages"]
    demo["Demo Request"]
    signup["Signup"]
    login["Login"]

    home --> pricing
    home --> preview
    home --> demo
    home --> signup
    home --> login
    seoProvince --> preview
    seoCategory --> preview
    preview --> signup
    pricing --> signup
    pricing --> demo
```

---

## 16. Contractor SaaS Monetization Funnel

Shows how the product converts contractor traffic into paid SaaS plans.

```mermaid
flowchart LR
    seo["SEO Tender / Contractor Category Pages"]
    preview["Limited Tender Preview"]
    signup["Signup"]
    onboarding["Contractor Onboarding"]
    profile["Profile Vault Completion"]
    value["Recommendations + Compliance Value Moment"]
    trial["Trial / Starter Plan"]
    paid["Paid Growth or Pro Plan"]
    retention["Alerts, Newspaper Coverage, Expiry Reminders"]
    expansion["More Users / Enterprise / Custom Sources"]

    seo --> preview
    preview --> signup
    signup --> onboarding
    onboarding --> profile
    profile --> value
    value --> trial
    trial --> paid
    paid --> retention
    retention --> expansion
```

---

## 17. Admin QA Workflow

Shows how ops users resolve low-confidence or ambiguous records.

```mermaid
stateDiagram-v2
    [*] --> Open
    Open --> InProgress: assign or start review
    InProgress --> Resolved: verify field / merge duplicate / fix source
    InProgress --> Dismissed: false positive
    Resolved --> [*]
    Dismissed --> [*]
```

---

## 18. Tender Lifecycle State Machine

Shows tender status transitions.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> UnderReview: automated extraction uncertain
    Draft --> Published: acceptable confidence
    UnderReview --> Published: ops verifies
    UnderReview --> Cancelled: invalid or withdrawn
    Published --> Corrigendum: source issues update
    Corrigendum --> Published: update applied
    Published --> Closed: closing date passed
    Published --> Cancelled: source cancels tender
    Closed --> [*]
    Cancelled --> [*]
```

---

## 19. Source Health State Machine

Shows how tender sources move between active, failing, and disabled.

```mermaid
stateDiagram-v2
    [*] --> Active
    Active --> Failing: ingestion failure
    Failing --> Active: successful run
    Failing --> Disabled: admin disables or repeated failures
    Disabled --> Active: admin re-enables
```

---

## 20. Payment and Subscription Flow

Shows subscription checkout and webhook handling.

```mermaid
sequenceDiagram
    participant Owner
    participant WebApp
    participant BillingService
    participant PayFast
    participant Database

    Owner->>WebApp: Select plan
    WebApp->>BillingService: Create checkout request
    BillingService->>Database: Create pending subscription/payment intent
    BillingService-->>WebApp: Checkout URL
    WebApp-->>Owner: Redirect to PayFast
    Owner->>PayFast: Complete payment
    PayFast->>BillingService: Send webhook
    BillingService->>BillingService: Verify webhook signature/payload
    BillingService->>Database: Activate subscription and record payment
    BillingService-->>PayFast: Acknowledge webhook
    Owner->>WebApp: Return to billing page
    WebApp->>Database: Load current subscription status
```

---

## 21. Alert Delivery Flow

Shows saved search and recommendation alert generation.

```mermaid
flowchart TD
    event["New Tender Published or Recommendation Rebuilt"]
    savedSearches["Load Saved Searches"]
    matchSearch{"Matches Saved Search?"}
    recThreshold{"Recommendation >= Threshold?"}
    notification["Create Notification"]
    channel{"Delivery Channel"}
    email["Send Email"]
    inApp["Show In-App"]
    whatsapp["WhatsApp Adapter"]
    log["Log Delivery Attempt"]
    retry{"Failed and Retryable?"}
    retryQueue["Schedule Retry"]

    event --> savedSearches
    savedSearches --> matchSearch
    event --> recThreshold
    matchSearch -- "yes" --> notification
    recThreshold -- "yes" --> notification
    matchSearch -- "no" --> end1["No Search Alert"]
    recThreshold -- "no" --> end2["No Recommendation Alert"]
    notification --> channel
    channel -- "email" --> email
    channel -- "in_app" --> inApp
    channel -- "whatsapp" --> whatsapp
    email --> log
    inApp --> log
    whatsapp --> log
    log --> retry
    retry -- "yes" --> retryQueue
    retry -- "no" --> done["Done"]
```

---

## 22. Data Quality Gate Flow

Shows how launch accuracy targets control whether fields are trusted.

```mermaid
flowchart TD
    sample["Manual QA Sample of 100+ Tenders"]
    measure["Measure Field Accuracy"]
    closing{"Closing Date >= 95%?"}
    source{"Department / Source URL >= 98%?"}
    bid{"Bid Security >= 90%?"}
    geo{"City / Province >= 90%?"}
    sector{"Sector >= 85%?"}
    pass["Field Can Be Trusted In Public UX"]
    qaMode["Keep Field In QA Review Mode"]
    improve["Improve Rules / Source Adapter"]

    sample --> measure
    measure --> closing
    closing --> source
    source --> bid
    bid --> geo
    geo --> sector
    sector -- "all pass" --> pass
    closing -- "no" --> qaMode
    source -- "no" --> qaMode
    bid -- "no" --> qaMode
    geo -- "no" --> qaMode
    sector -- "no" --> qaMode
    qaMode --> improve
    improve --> sample
```

---

## 23. Compliance Report Composition

Shows the sections required in every printable compliance report.

```mermaid
flowchart TD
    report["Compliance Report"]
    tenderDetails["Tender Details"]
    sourceEvidence["Source Evidence"]
    profileSnapshot["Company Profile Snapshot"]
    requirements["Detected Requirements"]
    checks["Checklist Results"]
    blockers["Blockers"]
    warnings["Warnings"]
    unknowns["Unknown / Needs Review"]
    nextSteps["Recommended Next Steps"]
    timestamp["Timestamp and Prepared By"]

    report --> tenderDetails
    report --> sourceEvidence
    report --> profileSnapshot
    report --> requirements
    report --> checks
    report --> blockers
    report --> warnings
    report --> unknowns
    report --> nextSteps
    report --> timestamp
```

---

## 24. Feature Gating Flow

Shows how subscription state gates premium features.

```mermaid
flowchart TD
    request["Feature Request"]
    org["Load Organization"]
    sub["Load Subscription"]
    status{"Subscription Active?"}
    plan{"Plan Allows Feature?"}
    allow["Allow Feature"]
    readonly["Allow Read-Only / Limited Preview"]
    deny["Deny With Upgrade Prompt"]
    grace{"Within Grace Period?"}

    request --> org
    org --> sub
    sub --> status
    status -- "yes" --> plan
    status -- "past_due" --> grace
    status -- "no" --> readonly
    grace -- "yes" --> plan
    grace -- "no" --> readonly
    plan -- "yes" --> allow
    plan -- "no" --> deny
```

---

## 25. End-to-End Happy Path

Shows the main product loop for a paying contractor.

```mermaid
journey
    title Contractor Finds and Evaluates a Tender
    section Onboarding
      Create account: 5: Owner
      Create organization: 5: Owner
      Complete Profile Vault: 4: Owner, Contractor Staff
      Upload documents: 4: Contractor Staff
    section Discovery
      Search tenders: 5: Contractor Staff
      Review recommendations: 5: Contractor Staff
      Open tender detail: 5: Contractor Staff
    section Readiness
      Run compliance check: 5: Contractor Staff
      Review blockers and warnings: 4: Contractor Staff
      Generate report: 5: Contractor Staff
    section Follow-up
      Save search alert: 4: Contractor Staff
      Receive matching tender alert: 5: Contractor Staff
```

---

## 26. Implementation Dependency Roadmap

Shows the safest build order for agents.

```mermaid
flowchart TD
    scaffold["Scaffold Monorepo"]
    db["Database, Enums, RLS, Storage"]
    auth["Auth, Organizations, Roles"]
    profile["Profile Vault"]
    manualTender["Manual Tender Entry"]
    source["First Source Adapter"]
    newspaper["Newspaper Source Adapter"]
    ingestion["Ingestion Worker"]
    parsing["Document Parsing and OCR"]
    extraction["Field Extraction"]
    qa["QA Dashboard"]
    search["Tender Search"]
    scoring["Recommendations"]
    compliance["Compliance Reports"]
    alerts["Saved Searches and Alerts"]
    billing["Billing and Plan Gates"]
    hardening["Monitoring, Backups, Launch QA"]

    scaffold --> db
    db --> auth
    auth --> profile
    auth --> manualTender
    manualTender --> source
    source --> newspaper
    source --> ingestion
    newspaper --> ingestion
    ingestion --> parsing
    parsing --> extraction
    extraction --> qa
    extraction --> search
    profile --> scoring
    search --> scoring
    scoring --> compliance
    compliance --> alerts
    alerts --> billing
    billing --> hardening
```

---

## 27. Tender Search Request Flow

Shows how public and authenticated tender searches share the same server-side search contract while preserving plan-gated visibility.

```mermaid
flowchart TD
    publicPage["/tenders Public Preview"]
    authPage["/search Authenticated App"]
    api["GET /api/tenders"]
    schema["tenderSearchSchema"]
    service["apps/web/lib/tender-search.ts"]
    plan{"Plan Access"}
    free["Free/Public Serializer"]
    paid["Paid/Ops Serializer"]
    postgres["Postgres tenders + search_document"]
    filters["Filter Indexes"]
    pec["extracted_fields PEC Filter"]
    recs["recommendations Score/Eligibility"]
    response["{ data, pagination, meta }"]

    publicPage --> service
    authPage --> service
    api --> schema
    schema --> service
    service --> postgres
    service --> filters
    service --> pec
    service --> recs
    service --> plan
    plan -- "free/public" --> free
    plan -- "paid/ops" --> paid
    free --> response
    paid --> response
```

---

## 28. Frontend Motion and UI Layer

Shows the frontend-only UI/UX enhancement layer. This layer does not change ingestion, scoring, database persistence, or backend authorization.

```mermaid
flowchart TD
    layout["app/layout.tsx"]
    pageTransition["PageTransition"]
    tokens["Tailwind Tokens + globals.css"]
    motionPrimitives["components/motion.tsx"]
    uiPrimitives["components/ui.tsx"]
    publicPages["Public Pages"]
    appShell["Authenticated App Shell"]
    dataPages["Dashboard, Search, Recommendations, Profile, Billing"]
    reducedMotion["prefers-reduced-motion"]

    layout --> pageTransition
    tokens --> uiPrimitives
    motionPrimitives --> pageTransition
    motionPrimitives --> dataPages
    uiPrimitives --> publicPages
    uiPrimitives --> appShell
    uiPrimitives --> dataPages
    reducedMotion --> tokens
    reducedMotion --> motionPrimitives
```
