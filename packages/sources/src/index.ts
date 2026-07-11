import * as cheerio from "cheerio";
import { Agent } from "undici";
import {
  PermanentSourceError,
  SourceFetchError,
  normalizeWhitespace,
  safeJson,
  sourceRuntimeConfig,
  type Json,
  type RawTenderPayload,
  type SourceAdapter,
  type SourceAdapterContext,
  type SourceType
} from "@tenderlo/shared";

const defaultUserAgent = "TenderLoBot/0.1 (+https://tenderlo.local; public-only polite contractor tender indexing)";

const inaccessiblePatterns = [
  /captcha/i,
  /login required/i,
  /sign in/i,
  /subscribe to continue/i,
  /paywall/i,
  /access denied/i,
  /forbidden/i,
  /not authorized/i
];

type SelectorProfile = {
  rowSelector: string;
  linkSelector?: string;
  titleSelector?: string;
  tenderNumberSelector?: string;
  departmentSelector?: string;
  advertisementDateSelector?: string;
  closingDateSelector?: string;
  citySelector?: string;
  estimatedValueSelector?: string;
  documentSelector?: string;
};

type SourceProfile = {
  key: string;
  name: string;
  sourceType: SourceType;
  region?: string;
  listing: SelectorProfile;
  detail?: Partial<SelectorProfile>;
  defaultProcurementMethod?: string;
  defaultSubmissionMethod?: string;
  defaultCategory?: string;
  newspaperName?: string;
  sourceGroup?: string | undefined;
  documentPrefix?: string | undefined;
  knownSourceDomains?: string[] | undefined;
  portalFamily?: string | undefined;
};

type BuildPayloadInput = {
  sourceUrl: string;
  title: string;
  tenderNumber?: string | undefined;
  department?: string | undefined;
  advertisementDate?: string | undefined;
  closingDate?: string | undefined;
  city?: string | undefined;
  estimatedValue?: number | undefined;
  description: string;
  documents: RawTenderPayload["documents"];
  rawHtml: string;
  procurementMethod?: string | undefined;
  submissionMethod?: string | undefined;
  contactPerson?: string | undefined;
  originalSourceUrl?: string | undefined;
  websiteUrl?: string | undefined;
};

export class ProfiledPublicSourceAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key: string;
  readonly name: string;
  readonly sourceType: SourceType;

  constructor(private readonly profile: SourceProfile) {
    this.key = profile.key;
    this.name = profile.name;
    this.sourceType = profile.sourceType;
  }

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(this.profile, context.metadata);
    const listing = await fetchPublicText(context.baseUrl, context.userAgent);
    const $ = cheerio.load(listing.text);
    const rowPayloads = parseProfileRows($, context.baseUrl, profile, listing.text);
    const linkPayloads = rowPayloads.length ? rowPayloads : parseFallbackLinks($, context.baseUrl, profile, listing.text);
    const payloads: RawTenderPayload[] = [];

    for (const payload of linkPayloads.slice(0, sourceRuntimeConfig.maxLinksPerSourceRun)) {
      const detailUrl = payload.sourceUrl;
      if (!shouldFetchDetail(detailUrl, context.baseUrl)) {
        payloads.push(payload);
        continue;
      }
      // Skip if the URL is not valid — prevents URI malformed crashes
      try { new URL(detailUrl); } catch {
        payloads.push(payload);
        continue;
      }

      await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      try {
        const detail = await fetchPublicText(detailUrl, context.userAgent);
        const parsed = parseDetailPage(detail.text, detailUrl, profile, payload);
        payloads.push(parsed ?? payload);
      } catch (fetchError) {
        // Non-fatal: keep the listing-page payload even if detail page fetch fails
        payloads.push(payload);
      }
    }

    return payloads;
  }
}

abstract class OcrNewspaperAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  abstract readonly key: string;
  abstract readonly name: string;
  readonly sourceType: SourceType = "newspaper";

  /** Return the full URL of today's classified/tender page JPG, or null if not found. */
  protected abstract resolveClassifiedImageUrl(indexHtml: string, baseUrl: string, today: Date): string | null;

  /** Return the index/listing page URL to fetch first. Can be overridden per edition. */
  protected getIndexUrl(baseUrl: string, _today: Date): string {
    return baseUrl;
  }

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const today = new Date();
    const indexUrl = this.getIndexUrl(context.baseUrl, today);

    // 1. Fetch index page
    const indexRes = await fetchText(indexUrl, context.userAgent);
    if (!indexRes.ok) throw new SourceFetchError(`${this.name} index returned HTTP ${indexRes.status}`);

    // 2. Resolve classified page image URL
    const imageUrl = this.resolveClassifiedImageUrl(indexRes.text, context.baseUrl, today);
    if (!imageUrl) {
      // Not an error — newspaper may not publish classifieds every day
      return [];
    }

    // 3. Download the image
    const imgRes = await fetchBinary(imageUrl, context.userAgent);
    if (!imgRes.ok) throw new SourceFetchError(`${this.name} classified image returned HTTP ${imgRes.status}`);
    // Guard against servers returning HTML with HTTP 200 for missing images (soft 404)
    if (!imgRes.contentType.startsWith("image/")) {
      throw new SourceFetchError(`${this.name} classified image URL returned non-image content (${imgRes.contentType}). The image may not be published yet for today.`);
    }

    // 4. OCR via the context's parseDocument delegate
    let ocrText = "";
    try {
      if (!context.parseDocument) {
        throw new Error("OCR parser function not provided in context");
      }
      const result = await context.parseDocument({
        buffer: imgRes.buffer,
        mimeType: "image/jpeg",
        filename: "classified.jpg",
        sourceUrl: imageUrl
      });
      ocrText = result.pages.map((p) => p.text).join("\n\n");
    } catch (ocrError) {
      throw new SourceFetchError(`${this.name} OCR failed: ${ocrError instanceof Error ? ocrError.message : String(ocrError)}`);
    }

    if (!ocrText.trim()) return [];

    // 5. Split OCR text into individual tender blocks
    const blocks = splitIntoTenderBlocks(ocrText);
    const advertisementDate = formatDateIso(today);
    const payloads: RawTenderPayload[] = [];

    for (const block of blocks) {
      if (block.trim().length < 30) continue;
      const title = extractFirstLine(block);
      if (!title) continue;
      payloads.push({
        sourceUrl: imageUrl,
        title: title.slice(0, 500),
        description: block.slice(0, 4000),
        advertisementDate,
        procurementMethod: "Newspaper tender notice",
        submissionMethod: "As stated in newspaper notice",
        documents: [{ url: imageUrl, filename: "classified-page.jpg", mimeType: "image/jpeg" }],
        sourceMetadata: safeJson({
          newspaper: this.name,
          ocr_source_image: imageUrl,
          extraction_method: "ocr_newspaper_classified",
          adapterKey: this.key
        }),
        raw: safeJson({
          title: title.slice(0, 500),
          body: block.slice(0, 4000),
          sourceType: "newspaper",
          adapterKey: this.key,
          fetchedAt: new Date().toISOString()
        })
      });
    }
    return payloads;
  }
}

/** Split OCR text into individual tender/notice blocks */
function splitIntoTenderBlocks(text: string): string[] {
  // Split on NIT patterns, dept headers, or 2+ consecutive blank lines
  const nitPattern = /(?=(?:NIT|NIT No|Tender No|NOTICE|INVITATION|OPEN TENDER|SEALED TENDER|REQUEST FOR|RFQ|RFP|EOI|EXPRESSION OF INTEREST|QUOTATION)[.\s:#-])/i;
  const blocks = text.split(nitPattern).map((b) => b.trim()).filter((b) => b.length > 20);
  // If no NIT splits found, fall back to double-newline blocks
  if (blocks.length <= 1) {
    return text.split(/\n{3,}/).map((b) => b.trim()).filter((b) => b.length > 30);
  }
  return blocks;
}

/** Get the first meaningful line as a title */
function extractFirstLine(block: string): string | undefined {
  const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
  return lines[0]?.slice(0, 300);
}

/** Format a Date as YYYY-MM-DD */
function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Jang E-Paper Adapter ────────────────────────────────────────────────────
// URL pattern: https://e.jang.com.pk/{city}/{DD-MM-YYYY}/page{N}
// Classified page is page5 (کلاسیفائیڈ) and page7 (اشتہارات)
// Image URL: https://e.jang.com.pk/static_pages/{D-M-YYYY}/{city}/mainpage/page5.jpg

class JangEpaperAdapter extends OcrNewspaperAdapter {
  readonly key = "jang-epaper-public";
  readonly name = "Daily Jang Public E-Paper";

  protected getIndexUrl(_baseUrl: string, today: Date): string {
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    // Karachi edition, classified page (page5)
    return `https://e.jang.com.pk/karachi/${dd}-${mm}-${yyyy}/page5`;
  }

  protected resolveClassifiedImageUrl(_html: string, _baseUrl: string, today: Date): string | null {
    // Jang static_pages image URL uses M-D-YYYY format (month first, no zero-padding)
    // e.g., July 9 → 7-9-2026  (NOT 9-7-2026)
    const m = today.getMonth() + 1;
    const d = today.getDate();
    const yyyy = today.getFullYear();
    // page5 = Classified (کلاسیفائیڈ), page7 = Advertisements (اشتہارات)
    return `https://e.jang.com.pk/static_pages/${m}-${d}-${yyyy}/karachi/mainpage/page5.jpg`;
  }
}

// ─── Express E-Paper Adapter ──────────────────────────────────────────────────
// URL pattern: https://www.express.com.pk/epaper/Index.aspx?Issue=NP_LHE
// Image URLs embedded in page: NP_LHE/YYYYMMDD/YYYYMMDD-NP_LHE-Classified_PageC007_7.jpg
// Full image base: https://epaper.express.com.pk/

class ExpressEpaperAdapter extends OcrNewspaperAdapter {
  readonly key = "express-epaper-public";
  readonly name = "Daily Express Public E-Paper";

  protected resolveClassifiedImageUrl(html: string, _baseUrl: string, today: Date): string | null {
    // Find the Classified page thumbnail in the index HTML
    const classifiedMatch = html.match(/NP_LHE\/(\d+)\/(\d+-NP_LHE-Classified_[^'"\\]+\.jpg)/);
    if (classifiedMatch) {
      // Use the full-resolution image (remove -thumb suffix)
      const fullRes = classifiedMatch[2]!.replace("-thumb", "");
      return `https://www.express.com.pk/images/NP_LHE/${classifiedMatch[1]!}/${fullRes}`;
    }
    // Fallback: construct URL from today's date with known pattern
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}${mm}${dd}`;
    return `https://www.express.com.pk/images/NP_LHE/${dateStr}/${dateStr}-NP_LHE-Classified_PageC007_7.jpg`;
  }
}

export const sourceAdapters: SourceAdapter[] = [
  new ProfiledPublicSourceAdapter({
    key: "federal-epads",
    name: "Federal EPADS",
    sourceType: "federal",
    region: "Pakistan",
    sourceGroup: "ppra_epads",
    documentPrefix: "tender_ppra2",
    portalFamily: "ppra_epads",
    knownSourceDomains: [
      "epads.gov.pk",
      "vendors.epads.gov.pk",
      "eprocure.gov.pk",
      "procure.gov.pk",
      "ppra.org.pk"
    ],
    listing: {
      rowSelector: "table tbody tr, .table tbody tr, .card, .opportunity-card, .procurement-card",
      linkSelector: "a[href*='opportunities'], a[href*='procurements'], a[href*='tender'], a",
      titleSelector: "td:nth-child(3) a span",
      tenderNumberSelector: "td:nth-child(2) span, td:nth-child(2)",
      departmentSelector: "td:nth-child(3) > span",
      advertisementDateSelector: "td:nth-child(5) .bg-label-success",
      closingDateSelector: "td:nth-child(5) .bg-label-danger",
      estimatedValueSelector: "td:nth-child(7), .estimated-cost, .value",
      documentSelector: "a[href$='.pdf'], a[href*='download']"
    },
    detail: {
      titleSelector: "h1, h2, h3, h4, .title, .procurement-title, .bg-facebook, .badge-primary",
      departmentSelector: ".procuring-agency, .agency, .department, .organization",
      closingDateSelector: ".closing-date, .deadline, td:contains('Closing') + td",
      documentSelector: "a[href$='.pdf'], a:contains('Download PDF'), a[href*='download']"
    },
    defaultProcurementMethod: "As published on EPADS",
    defaultSubmissionMethod: "Electronic via EPADS"
  }),
  new ProfiledPublicSourceAdapter({
    key: "federal-ppra-active",
    name: "Federal PPRA Active Tenders",
    sourceType: "federal",
    region: "Pakistan",
    sourceGroup: "ppra_epads",
    documentPrefix: "tender_ppra2",
    portalFamily: "ppra_epads",
    knownSourceDomains: [
      "ppra.org.pk",
      "epms.ppra.gov.pk",
      "epads.gov.pk",
      "vendors.epads.gov.pk",
      "eprocure.gov.pk",
      "procure.gov.pk"
    ],
    listing: {
      rowSelector: "table tbody tr, table tr",
      linkSelector: "a[href*='tdoc'], a[href*='doc'], a[href*='tender'], a",
      titleSelector: "td:nth-child(3), td:nth-child(4), a",
      tenderNumberSelector: "td:nth-child(1), td:nth-child(2)",
      departmentSelector: "td:nth-child(2), td:nth-child(3)",
      advertisementDateSelector: "td:nth-child(5)",
      closingDateSelector: "td:nth-child(6), td:nth-child(7)",
      documentSelector: "a[href$='.pdf'], a[href*='tdoc'], a[href*='doc']"
    },
    defaultProcurementMethod: "Open competitive bidding",
    defaultSubmissionMethod: "As stated in PPRA notice"
  }),
  new ProfiledPublicSourceAdapter({
    key: "punjab-ppra",
    name: "Punjab PPRA",
    sourceType: "provincial",
    region: "Punjab",
    listing: {
      rowSelector: ".rgMasterTable tbody tr.rgRow, .rgMasterTable tbody tr.rgAltRow",
      linkSelector: "td:nth-child(8) a, td:nth-child(9) a, a",
      titleSelector: "td:nth-child(2)",
      tenderNumberSelector: "td:nth-child(8) a, td:nth-child(9) a",
      departmentSelector: "td:nth-child(6)",
      advertisementDateSelector: "td:nth-child(4)",
      closingDateSelector: "td:nth-child(5)",
      documentSelector: "td:nth-child(8) a, td:nth-child(9) a"
    },
    defaultProcurementMethod: "Punjab PPRA public procurement process",
    defaultSubmissionMethod: "As stated in Punjab PPRA notice"
  }),
  new ProfiledPublicSourceAdapter({
    key: "sindh-sppra",
    name: "Sindh SPPRA",
    sourceType: "provincial",
    region: "Sindh",
    sourceGroup: "sindh_sppra",
    documentPrefix: "tender_SINDH",
    portalFamily: "sindh_sppra",
    knownSourceDomains: [
      "pprasindh.gov.pk",
      "e.pprasindh.gov.pk",
      "epads.pprasindh.gov.pk",
      "portalsindh.eprocure.gov.pk",
      "sindh.eprocure.gov.pk"
    ],
    listing: {
      rowSelector: "#tender_list tbody tr",
      linkSelector: "td:nth-child(8) a",
      titleSelector: "td:nth-child(7)",
      tenderNumberSelector: "td:nth-child(2)",
      departmentSelector: "td:nth-child(3)",
      advertisementDateSelector: "td:nth-child(4)",
      closingDateSelector: "td:nth-child(5)",
      citySelector: "td:nth-child(7)",
      documentSelector: "td:nth-child(8) a"
    },
    detail: {
      documentSelector: "a[href$='.pdf'], a[href*='download']"
    },
    defaultProcurementMethod: "Sindh SPPRA public procurement process",
    defaultSubmissionMethod: "As stated in SPPRA notice"
  }),
  new ProfiledPublicSourceAdapter({
    key: "kp-ppra-active",
    name: "Khyber Pakhtunkhwa PPRA",
    sourceType: "provincial",
    region: "Khyber Pakhtunkhwa",
    sourceGroup: "kp_kppra",
    documentPrefix: "tender_kppra",
    portalFamily: "kp_kppra",
    knownSourceDomains: [
      "kppra.gov.pk",
      "portal.kppra.gov.pk",
      "kp.eprocure.gov.pk",
      "portalkp.eprocure.gov.pk",
      "phedkp.gov.pk",
      "lgkp.gov.pk",
      "irrigation.gkp.pk"
    ],
    listing: {
      rowSelector: "table tbody tr, table tr",
      linkSelector: "a[href*='tender'], a[href$='.pdf'], a",
      titleSelector: "td:nth-child(2), td:nth-child(3), a",
      tenderNumberSelector: "td:nth-child(1)",
      departmentSelector: "td:nth-child(3), td:nth-child(4)",
      advertisementDateSelector: "td:nth-child(5)",
      closingDateSelector: "td:nth-child(6)",
      citySelector: "td:nth-child(4), td:nth-child(7)",
      documentSelector: "a[href$='.pdf'], a[href*='download']"
    },
    defaultProcurementMethod: "KP PPRA public procurement process",
    defaultSubmissionMethod: "As stated in KP PPRA notice"
  }),
  new ProfiledPublicSourceAdapter({
    key: "balochistan-bppra",
    name: "Balochistan PPRA",
    sourceType: "provincial",
    region: "Balochistan",
    listing: {
      rowSelector: "table tbody tr, table tr, .tender, .card",
      linkSelector: "a[href*='tender'], a[href$='.pdf'], a",
      titleSelector: "td:nth-child(2), td:nth-child(3), h3, h4, a",
      tenderNumberSelector: "td:nth-child(1)",
      departmentSelector: "td:nth-child(3), td:nth-child(4), .department",
      advertisementDateSelector: "td:nth-child(4), td:nth-child(5)",
      closingDateSelector: "td:nth-child(5), td:nth-child(6), .deadline",
      citySelector: "td:nth-child(4), .city",
      documentSelector: "a[href$='.pdf'], a[href*='download']"
    },
    defaultProcurementMethod: "Balochistan PPRA public procurement process",
    defaultSubmissionMethod: "As stated in Balochistan PPRA notice"
  }),
  newspaperAdapter("business-recorder-tenders", "Business Recorder Tenders", "https://www.brecorder.com/business-finance/tenders"),
  newspaperAdapter("dawn-public-tenders", "Dawn Public Tender Notices", "https://www.dawn.com/classifieds/tenders"),
  new JangEpaperAdapter(),
  new ExpressEpaperAdapter(),
  new ProfiledPublicSourceAdapter({
    key: "ungm-public-pakistan",
    name: "UNGM Pakistan Public Notices",
    sourceType: "department",
    region: "Pakistan",
    listing: {
      rowSelector: "table tbody tr, .notice, .search-result, .result, article",
      linkSelector: "a[href*='notice'], a[href*='tender'], a",
      titleSelector: "td:nth-child(2), h3, h4, .title, a",
      tenderNumberSelector: "td:nth-child(1), .reference",
      departmentSelector: "td:nth-child(3), .agency, .organization",
      advertisementDateSelector: "td:nth-child(4), .published",
      closingDateSelector: "td:nth-child(5), .deadline, .closing-date",
      documentSelector: "a[href$='.pdf'], a[href*='document'], a[href*='download']"
    },
    defaultProcurementMethod: "UN public procurement notice",
    defaultSubmissionMethod: "As stated in UNGM notice"
  }),
  new ProfiledPublicSourceAdapter({
    key: "iom-pakistan-procurement",
    name: "IOM Pakistan Procurement Opportunities",
    sourceType: "department",
    region: "Pakistan",
    listing: {
      rowSelector: "table tbody tr:has(a), table tr:has(a)",
      linkSelector: "td:nth-child(1) a",
      titleSelector: "td:nth-child(1)",
      tenderNumberSelector: "td:nth-child(2)",
      advertisementDateSelector: "td:nth-child(4)",
      closingDateSelector: "td:nth-child(5)",
      documentSelector: "td:nth-child(1) a"
    },
    defaultProcurementMethod: "IOM public procurement notice",
    defaultSubmissionMethod: "As stated in IOM Pakistan notice"
  }),
  new ProfiledPublicSourceAdapter({
    key: "developmentaid-pakistan-public",
    name: "DevelopmentAid Pakistan Public Tenders",
    sourceType: "department",
    region: "Pakistan",
    listing: {
      rowSelector: "article, .tender, .tender-item, .search-result, .result, .card",
      linkSelector: "a[href*='/tenders/'], a[href*='tender'], a",
      titleSelector: "h2, h3, h4, .title, a",
      tenderNumberSelector: ".reference, .id",
      departmentSelector: ".funding-agency, .agency, .organization",
      advertisementDateSelector: ".posted, .date",
      closingDateSelector: ".deadline, .closing-date",
      estimatedValueSelector: ".budget, .value",
      documentSelector: "a[href$='.pdf'], a[href*='attachment'], a[href*='download']"
    },
    defaultProcurementMethod: "DevelopmentAid public listing",
    defaultSubmissionMethod: "As stated in DevelopmentAid listing"
  })
];

function newspaperAdapter(key: string, name: string, _baseUrl: string): ProfiledPublicSourceAdapter {
  return new ProfiledPublicSourceAdapter({
    key,
    name,
    sourceType: "newspaper",
    region: "Pakistan",
    newspaperName: name,
    listing: {
      rowSelector: "article, .story, .classified, .epaper-page, .views-row, .card, table tr",
      linkSelector: "a[href*='tender'], a[href*='classified'], a[href*='epaper'], a[href$='.jpg'], a[href$='.png'], a[href$='.pdf'], a",
      titleSelector: "h2, h3, h4, .title, a",
      departmentSelector: ".department, .agency, .organization",
      advertisementDateSelector: ".date, time",
      closingDateSelector: ".deadline, .closing-date",
      citySelector: ".city",
      documentSelector: "a[href$='.pdf'], a[href$='.jpg'], a[href$='.jpeg'], a[href$='.png'], a[href$='.webp']"
    },
    defaultProcurementMethod: "Newspaper tender notice",
    defaultSubmissionMethod: "As stated in newspaper notice"
  });
}

export function getSourceAdapter(adapterKey: string): SourceAdapter {
  const adapter = sourceAdapters.find((candidate) => candidate.key === adapterKey);
  if (!adapter) throw new Error(`No source adapter registered for ${adapterKey}`);
  return adapter;
}

export function createSourceContext(source: {
  id: string;
  name: string;
  base_url: string;
  adapter_key: string;
  metadata?: Json;
}): SourceAdapterContext {
  return {
    sourceId: source.id,
    sourceName: source.name,
    baseUrl: source.base_url,
    adapterKey: source.adapter_key,
    userAgent: process.env.TENDERLO_USER_AGENT ?? defaultUserAgent,
    metadata: source.metadata
  };
}

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

export async function fetchText(url: string, userAgent = defaultUserAgent): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(sourceRuntimeConfig.pageFetchTimeoutMs),
      dispatcher: insecureAgent
    } as any);
    const contentType = response.headers.get("content-type") ?? "text/plain";
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      contentType
    };
  } catch (error) {
    throw new SourceFetchError(error instanceof Error ? error.message : `Failed to fetch ${url}`);
  }
}

async function fetchPublicText(url: string, userAgent = defaultUserAgent): Promise<{ text: string; contentType: string }> {
  const response = await fetchText(url, userAgent);
  if (!response.ok) throw new SourceFetchError(`Source ${url} returned HTTP ${response.status}`);
  if (isInaccessible(response.text)) throw new PermanentSourceError(`Source ${url} is not publicly accessible without controls.`);
  return { text: response.text, contentType: response.contentType };
}

export async function fetchBinary(url: string, userAgent = defaultUserAgent): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,text/html,*/*"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(sourceRuntimeConfig.documentFetchTimeoutMs),
      dispatcher: insecureAgent
    } as any);
    const arrayBuffer = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get("content-type") ?? "application/octet-stream"
    };
  } catch (error) {
    throw new SourceFetchError(error instanceof Error ? error.message : `Failed to fetch ${url}`);
  }
}

export function isInaccessible(text: string): boolean {
  const sample = text.slice(0, 20_000);
  return inaccessiblePatterns.some((pattern) => pattern.test(sample));
}

export function parseProfileRows($: cheerio.CheerioAPI, baseUrl: string, profile: SourceProfile, rawHtml: string): RawTenderPayload[] {
  const payloads: RawTenderPayload[] = [];
  const seen = new Set<string>();
  $(profile.listing.rowSelector).each((_, row) => {
    const payload = parseRow($, row, baseUrl, profile, rawHtml);
    if (!payload) return;
    const key = `${payload.sourceUrl}|${payload.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    payloads.push(payload);
  });
  return payloads;
}

function parseFallbackLinks($: cheerio.CheerioAPI, baseUrl: string, profile: SourceProfile, rawHtml: string): RawTenderPayload[] {
  const payloads: RawTenderPayload[] = [];
  const seen = new Set<string>();
  $("a").each((_, element) => {
    const href = $(element).attr("href");
    const title = normalizeWhitespace($(element).text());
    if (!href || !title) return;
    const lower = `${href} ${title}`.toLowerCase();
    if (!/(tender|procurement|quotation|bid|notice|classified|epaper|e-paper|auction|opportunit|rfp|rfq|itb|eoi)/.test(lower)) return;
    const url = new URL(href, baseUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);
    payloads.push(buildPayload(profile, {
      sourceUrl: url,
      title: title.slice(0, 500),
      department: profile.name,
      description: title,
      documents: [],
      websiteUrl: sourceOrigin(url),
      rawHtml
    }));
  });
  return payloads;
}

function parseRow($: cheerio.CheerioAPI, row: any, baseUrl: string, profile: SourceProfile, rawHtml: string): RawTenderPayload | null {
  const rowHandle = $(row);
  const linkElement = profile.listing.linkSelector ? rowHandle.find(profile.listing.linkSelector).first() : rowHandle.find("a").first();
  const href = linkElement.attr("href");
  const rowText = normalizeWhitespace(rowHandle.text());
  let title =
    selectText($, rowHandle, profile.listing.titleSelector) ||
    normalizeWhitespace(linkElement.text()) ||
    rowText.slice(0, 240);

  if (profile.key === "iom-pakistan-procurement" && title) {
    const cell = rowHandle.find("td:nth-child(1)");
    const firstText = cell.clone().children("ul, ol, div, span").remove().end().text().trim();
    if (firstText) {
      title = firstText;
    }
  }

  if (!title || title.length < 4 || !/(tender|procurement|quotation|bid|notice|rfp|rfq|eoi|works?|supply|services?|auction|expression)/i.test(`${title} ${rowText}`)) {
    return null;
  }
  const sourceUrl = href ? new URL(href, baseUrl).toString() : baseUrl;
  const provenance = collectSourceProvenanceLinks($, rowHandle, sourceUrl, baseUrl);
  const documents = collectDocumentLinks($, rowHandle, baseUrl, profile.listing.documentSelector);
  if (href && isDocumentUrl(sourceUrl) && !documents.some((doc) => doc.url === sourceUrl)) {
    documents.push({ url: sourceUrl, filename: filenameFromUrl(sourceUrl), mimeType: mimeFromUrl(sourceUrl) });
  }

  return buildPayload(profile, {
    sourceUrl: normalizeSourceUrl(sourceUrl),
    title,
    tenderNumber: selectText($, rowHandle, profile.listing.tenderNumberSelector),
    department: selectText($, rowHandle, profile.listing.departmentSelector) || profile.name,
    advertisementDate: normalizeDate(selectText($, rowHandle, profile.listing.advertisementDateSelector)),
    closingDate: normalizeDate(selectText($, rowHandle, profile.listing.closingDateSelector) || rowText),
    city: selectText($, rowHandle, profile.listing.citySelector),
    estimatedValue: parseMoney(selectText($, rowHandle, profile.listing.estimatedValueSelector)),
    description: rowText,
    documents,
    originalSourceUrl: provenance.originalSourceUrl,
    websiteUrl: provenance.websiteUrl,
    rawHtml
  });
}

function parseDetailPage(html: string, sourceUrl: string, profile: SourceProfile, listingPayload: RawTenderPayload): RawTenderPayload | null {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  const body = normalizeWhitespace($("main").text() || $("article").text() || $("body").text() || $.root().text());
  if (body.length < 30) return null;
  const root = $.root();
  const detail = profile.detail ?? {};
  const provenance = collectSourceProvenanceLinks($, root, sourceUrl, sourceUrl);
  const documents = [
    ...listingPayload.documents,
    ...collectDocumentLinks($, root, sourceUrl, detail.documentSelector ?? profile.listing.documentSelector)
  ];
  return buildPayload(profile, {
    sourceUrl: normalizeSourceUrl(sourceUrl),
    title: selectText($, root, detail.titleSelector) || listingPayload.title,
    tenderNumber: selectText($, root, detail.tenderNumberSelector) || listingPayload.tenderNumber,
    department: selectText($, root, detail.departmentSelector) || listingPayload.department || profile.name,
    advertisementDate: normalizeDate(selectText($, root, detail.advertisementDateSelector)) || listingPayload.advertisementDate,
    closingDate: normalizeDate(selectText($, root, detail.closingDateSelector) || body) || listingPayload.closingDate,
    city: selectText($, root, detail.citySelector) || listingPayload.city,
    estimatedValue: parseMoney(selectText($, root, detail.estimatedValueSelector)) ?? listingPayload.estimatedValue,
    description: body.slice(0, 4000),
    documents: dedupeDocuments(documents),
    originalSourceUrl: provenance.originalSourceUrl ?? listingPayload.originalSourceUrl,
    websiteUrl: provenance.websiteUrl ?? listingPayload.websiteUrl,
    rawHtml: html,
    procurementMethod: inferProcurementMethod(body) || listingPayload.procurementMethod,
    submissionMethod: inferSubmissionMethod(body) || listingPayload.submissionMethod,
    contactPerson: inferContactPerson(body) || listingPayload.contactPerson
  });
}

function buildPayload(
  profile: SourceProfile,
  input: BuildPayloadInput
): RawTenderPayload {
  const originalSourceUrl = input.originalSourceUrl ? normalizeSourceUrl(input.originalSourceUrl) : undefined;
  const websiteUrl = input.websiteUrl ? normalizeSourceUrl(input.websiteUrl) : originalSourceUrl ? sourceOrigin(originalSourceUrl) : sourceOrigin(input.sourceUrl);
  const knownSourceDomains = profile.knownSourceDomains?.map(normalizeDomain).filter(Boolean) ?? [];
  const sourceMetadata = safeJson({
    adapterKey: profile.key,
    portalFamily: profile.portalFamily,
    documentPrefix: profile.documentPrefix,
    knownSourceDomains
  });
  return stripUndefinedPayload({
    sourceUrl: normalizeSourceUrl(input.sourceUrl),
    title: normalizeWhitespace(input.title).slice(0, 500),
    sourceGroup: profile.sourceGroup,
    sourceLabel: profile.name,
    originalSourceUrl,
    websiteUrl,
    sourceMetadata,
    tenderNumber: cleanOptional(input.tenderNumber),
    department: cleanOptional(input.department) ?? profile.name,
    procurementCategory: profile.defaultCategory,
    province: profile.region && profile.region !== "Pakistan" ? profile.region : undefined,
    city: cleanOptional(input.city),
    description: normalizeWhitespace(input.description).slice(0, 4000),
    advertisementDate: input.advertisementDate,
    closingDate: input.closingDate,
    estimatedValue: input.estimatedValue,
    procurementMethod: cleanOptional(input.procurementMethod) ?? profile.defaultProcurementMethod,
    submissionMethod: cleanOptional(input.submissionMethod) ?? profile.defaultSubmissionMethod,
    contactPerson: cleanOptional(input.contactPerson),
    newspaperName: profile.newspaperName,
    publicationDate: profile.sourceType === "newspaper" ? input.advertisementDate : undefined,
    pageSection: profile.sourceType === "newspaper" ? "tenders/classifieds" : undefined,
    documents: enrichDocuments(dedupeDocuments(input.documents), profile, { originalSourceUrl, websiteUrl }),
    raw: safeJson({
      title: input.title,
      body: input.description.slice(0, 20_000),
      sourceType: profile.sourceType,
      adapterKey: profile.key,
      sourceGroup: profile.sourceGroup,
      portalFamily: profile.portalFamily,
      originalSourceUrl,
      websiteUrl,
      fetchedAt: new Date().toISOString()
    }),
    rawSnapshot: {
      content: input.rawHtml,
      contentType: "text/html; charset=utf-8",
      extension: "html"
    }
  });
}

function resolveProfileMetadata(profile: SourceProfile, metadata: Json | undefined): SourceProfile {
  const sourceMetadata = metadataRecord(metadata);
  if (!sourceMetadata) return profile;
  return {
    ...profile,
    sourceGroup: metadataString(sourceMetadata.sourceGroup) ?? profile.sourceGroup,
    documentPrefix: metadataString(sourceMetadata.documentPrefix) ?? profile.documentPrefix,
    portalFamily: metadataString(sourceMetadata.portalFamily) ?? profile.portalFamily,
    knownSourceDomains: metadataStringArray(sourceMetadata.knownSourceDomains) ?? profile.knownSourceDomains
  };
}

function enrichDocuments(
  documents: RawTenderPayload["documents"],
  profile: SourceProfile,
  provenance: { originalSourceUrl?: string | undefined; websiteUrl?: string | undefined }
): RawTenderPayload["documents"] {
  return documents.map((document) => ({
    ...document,
    url: normalizeSourceUrl(document.url),
    sourceLabel: document.sourceLabel ?? profile.name,
    originalSourceUrl: document.originalSourceUrl ?? provenance.originalSourceUrl,
    websiteUrl: document.websiteUrl ?? provenance.websiteUrl,
    sourceDocumentKey: document.sourceDocumentKey ?? sourceDocumentKey(document.url, profile.documentPrefix)
  }));
}

function collectSourceProvenanceLinks(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<any>,
  sourceUrl: string,
  baseUrl: string
): { originalSourceUrl?: string | undefined; websiteUrl?: string | undefined } {
  const sourceHost = normalizeSourceHostname(sourceUrl);
  const candidates: Array<{ url: string; label: string; host: string | null }> = [];
  root.find("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#") || /^mailto:|^tel:/i.test(href)) return;
    const url = normalizeSourceUrl(new URL(href, baseUrl).toString());
    if (isDocumentUrl(url)) return;
    const label = normalizeWhitespace($(element).text());
    const host = normalizeSourceHostname(url);
    if (!host || url === normalizeSourceUrl(sourceUrl)) return;
    candidates.push({ url, label, host });
  });

  const labeledWebsite = candidates.find((candidate) => /website|source|official|department|agency|portal/i.test(candidate.label));
  const external = candidates.find((candidate) => candidate.host !== sourceHost);
  const originalSourceUrl = external?.url ?? labeledWebsite?.url;
  const websiteUrl = labeledWebsite?.url ?? (originalSourceUrl ? sourceOrigin(originalSourceUrl) : undefined);
  return { originalSourceUrl, websiteUrl };
}

function selectText($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, selector?: string): string | undefined {
  if (!selector) return undefined;
  const value = normalizeWhitespace(root.find(selector).first().text());
  return value || undefined;
}

function collectDocumentLinks(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<any>,
  sourceUrl: string,
  selector = "a"
): RawTenderPayload["documents"] {
  const documents: RawTenderPayload["documents"] = [];
  root.find(selector).each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const url = normalizeSourceUrl(new URL(href, sourceUrl).toString());
    if (!isDocumentUrl(url) && !/download|attachment|document/i.test(`${href} ${$(element).text()}`)) return;
    documents.push({
      url,
      filename: filenameFromUrl(url),
      mimeType: mimeFromUrl(url)
    });
  });
  return dedupeDocuments(documents);
}

function isDocumentUrl(url: string): boolean {
  return /\.(pdf|docx?|png|jpe?g|tiff?|webp)(\?|$)/i.test(url);
}

function mimeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".pdf")) return "application/pdf";
  if (lower.includes(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.includes(".doc")) return "application/msword";
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".tif") || lower.includes(".tiff")) return "image/tiff";
  if (lower.includes(".webp")) return "image/webp";
  return "application/octet-stream";
}

function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "tender-document");
  } catch {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split("/").filter(Boolean).pop() ?? "tender-document";
    } catch {
      return "tender-document";
    }
  }
}

function dedupeDocuments(documents: RawTenderPayload["documents"]): RawTenderPayload["documents"] {
  const seen = new Set<string>();
  return documents.filter((document) => {
    const normalizedUrl = normalizeSourceUrl(document.url);
    if (seen.has(normalizedUrl)) return false;
    seen.add(normalizedUrl);
    document.url = normalizedUrl;
    return true;
  });
}

export function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = normalizeDomain(url.hostname);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function normalizeSourceHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeDomain(value.includes("://") ? new URL(value).hostname : value);
  } catch {
    return normalizeDomain(value);
  }
}

export function isKnownSourceDomain(url: string | null | undefined, knownSourceDomains: string[] | undefined): boolean | null {
  const host = normalizeSourceHostname(url);
  const known = knownSourceDomains?.map(normalizeDomain).filter(Boolean) ?? [];
  if (!host || !known.length) return null;
  return known.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function sourceOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return normalizeSourceUrl(url.toString());
  } catch {
    return undefined;
  }
}

function sourceDocumentKey(url: string, documentPrefix?: string): string | undefined {
  const filename = filenameFromUrl(url).replace(/\.[^.]+$/, "");
  if (!filename) return undefined;
  if (!documentPrefix) return filename.slice(0, 160);
  const escapedPrefix = documentPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = filename.match(new RegExp(`${escapedPrefix}[_-]?[a-z0-9_-]*`, "i"));
  return (match?.[0] ?? filename).slice(0, 160);
}

function metadataRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function metadataString(value: Json | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataStringArray(value: Json | undefined): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = normalizeWhitespace(value);
  const cleanedText = text.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1");
  const numeric = cleanedText.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const rawYear = Number(numeric[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const hour = normalizeHour(numeric[4], numeric[6]);
    const minute = numeric[5] ? Number(numeric[5]) : 0;
    const date = new Date(Date.UTC(year, month, day, hour, minute));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const parsed = Date.parse(cleanedText);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function normalizeHour(value?: string, meridiem?: string): number {
  let hour = value ? Number(value) : 0;
  if (meridiem?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (meridiem?.toLowerCase() === "am" && hour === 12) hour = 0;
  return hour;
}

function parseMoney(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:PKR|Rs\.?|Rupees?)?\s*([0-9][0-9,]*(?:\.\d+)?)\s*(billion|million|crore|lakh|lac|m|bn)?/i);
  if (!match?.[1]) return undefined;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;
  const unit = match[2]?.toLowerCase();
  const multiplier = unit?.startsWith("b") || unit === "bn" ? 1_000_000_000 : unit?.startsWith("m") ? 1_000_000 : unit === "crore" ? 10_000_000 : unit === "lakh" || unit === "lac" ? 100_000 : 1;
  return base * multiplier;
}

function inferProcurementMethod(text: string): string | undefined {
  const match = text.match(/\b(single stage(?:\s+single|\s+two)? envelope|open competitive bidding|national competitive bidding|request for quotation|request for proposal|invitation to bid)\b/i);
  return match?.[1] ? normalizeWhitespace(match[1]) : undefined;
}

function inferSubmissionMethod(text: string): string | undefined {
  if (/epads|e-pak acquisition|electronic submission|e-submission|online submission/i.test(text)) return "Electronic via EPADS or stated online portal";
  if (/sealed bids?|hard copy|submit.*office|by hand|courier/i.test(text)) return "Physical sealed bid submission";
  return undefined;
}

function inferContactPerson(text: string): string | undefined {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text.match(/(?:\+92|0)\s?\d{2,4}[-\s]?\d{6,8}/)?.[0];
  const label = text.match(/\b(?:contact person|focal person|office of|for information)\s*[:\-]?\s*([^.;\n]{5,120})/i)?.[1];
  return normalizeWhitespace([label, email, phone].filter(Boolean).join(" | ")) || undefined;
}

function cleanOptional(value: string | undefined): string | undefined {
  const normalized = value ? normalizeWhitespace(value) : "";
  return normalized || undefined;
}

function stripUndefinedPayload(payload: Record<string, unknown>): RawTenderPayload {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as unknown as RawTenderPayload;
}

function shouldFetchDetail(detailUrl: string, baseUrl: string): boolean {
  if (detailUrl === baseUrl) return false;
  if (isDocumentUrl(detailUrl)) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
