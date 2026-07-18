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

/**
 * Public-page fallback for portals whose public HTML is rendered only in a
 * browser. Adapters should prefer documented public JSON/HTML requests and
 * call this only when rendering is genuinely required. It deliberately does
 * not solve CAPTCHA, login, paywall, or other access-control challenges.
 */
export async function fetchRenderedPublicPage(url: string, userAgent = defaultUserAgent): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent });
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    if (!response || !response.ok()) {
      throw new SourceFetchError(`Public browser request returned HTTP ${response?.status() ?? "no response"}.`);
    }
    const html = await page.content();
    if (inaccessiblePatterns.some((pattern) => pattern.test(html))) {
      throw new PermanentSourceError("The public source requires access that TenderLo will not bypass.");
    }
    return html;
  } finally {
    await browser.close();
  }
}

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
  sourceStatus?: string | undefined;
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

const federalEpadsProfile: SourceProfile = {
  key: "federal-epads",
  name: "Federal EPADS",
  sourceType: "federal",
  region: "Pakistan",
  sourceGroup: "ppra_epads",
  documentPrefix: "tender_ppra2",
  portalFamily: "ppra_epads",
  knownSourceDomains: [
    "epads.gov.pk",
    "pa.epads.gov.pk",
    "vendors.epads.gov.pk",
    "eprocure.gov.pk",
    "procure.gov.pk",
    "ppra.org.pk"
  ],
  listing: {
    rowSelector: "table.table-cb tbody tr"
  },
  defaultSubmissionMethod: "Electronic via EPADS"
};

export class FederalEpadsAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = federalEpadsProfile.key;
  readonly name = federalEpadsProfile.name;
  readonly sourceType: SourceType = federalEpadsProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(federalEpadsProfile, context.metadata);
    const firstPageUrl = federalEpadsPageUrl(context.baseUrl, 1);
    const firstPage = await fetchPublicText(firstPageUrl, context.userAgent);
    const payloads = parseFederalEpadsListing(firstPage.text, firstPageUrl, profile);
    const lastPage = federalEpadsLastPage(firstPage.text, firstPageUrl);

    for (let page = 2; page <= lastPage; page += 1) {
      await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      const pageUrl = federalEpadsPageUrl(context.baseUrl, page);
      const response = await fetchPublicText(pageUrl, context.userAgent);
      payloads.push(...parseFederalEpadsListing(response.text, pageUrl, profile));
    }

    const unique = new Map<string, RawTenderPayload>();
    for (const payload of payloads) unique.set(payload.sourceUrl, payload);
    if (!unique.size) throw new SourceFetchError("Federal EPADS returned no procurement rows.");
    return [...unique.values()];
  }
}

export function parseFederalEpadsListing(
  html: string,
  pageUrl: string,
  profile: SourceProfile = federalEpadsProfile
): RawTenderPayload[] {
  const $ = cheerio.load(html);
  const payloads: RawTenderPayload[] = [];

  $(profile.listing.rowSelector).each((_, row) => {
    const rowHandle = $(row);
    const cells = rowHandle.find("td");
    if (cells.length < 6) return;

    const tenderNumber = normalizeWhitespace(cells.eq(1).text()).toUpperCase();
    const titleLink = cells.eq(2).find("a[href*='/opportunities/federal/procurements/']").first();
    const tooltipElements = cells.eq(2).find("[data-bs-original-title], [title]");
    const titleElement = titleLink.find("[data-bs-original-title], [title]").first();
    const departmentElement = tooltipElements.eq(1);
    const title = normalizeWhitespace(titleElement.attr("data-bs-original-title") ?? titleElement.attr("title") ?? titleElement.text() ?? titleLink.text());
    const department = normalizeWhitespace(departmentElement.attr("data-bs-original-title") ?? departmentElement.attr("title") ?? departmentElement.text());
    const detailHref = titleLink.attr("href") ?? cells.eq(5).find("a[href]").first().attr("href");
    if (!detailHref || !/^P\d+$/i.test(tenderNumber) || title.length < 4) return;

    const sourceUrl = normalizeSourceUrl(new URL(detailHref, pageUrl).toString());
    const advertisementDateText = epadsStatusValue($, cells.eq(3), "Published On");
    const closingDateText = epadsStatusValue($, cells.eq(3), "Closing On");
    const procurementCategory = normalizeWhitespace(cells.eq(4).find(".badge").first().text());
    const procurementMethod = normalizeWhitespace(cells.eq(4).find("span.text-secondary").first().text());
    const hasStandardBiddingDocument = /\b(?:single|two) stage\b/i.test(procurementMethod);
    const description = normalizeWhitespace([
      title,
      department,
      procurementCategory,
      procurementMethod,
      advertisementDateText ? `Published On: ${advertisementDateText}` : "",
      closingDateText ? `Closing On: ${closingDateText}` : ""
    ].filter(Boolean).join(". "));
    const rawRowHtml = $.html(rowHandle);

    payloads.push(buildPayload(profile, {
      sourceUrl,
      title,
      tenderNumber,
      department: department || profile.name,
      advertisementDate: parseFederalEpadsDate(advertisementDateText),
      closingDate: parseFederalEpadsDeadline(closingDateText),
      description,
      procurementMethod: procurementMethod || profile.defaultProcurementMethod,
      submissionMethod: profile.defaultSubmissionMethod,
      websiteUrl: "https://epads.gov.pk/",
      documents: hasStandardBiddingDocument ? [{
        url: `https://pa.epads.gov.pk/procurement/SBD/${tenderNumber.toLowerCase()}/bidding-document.pdf?download=true`,
        filename: `${tenderNumber}-bidding-document.pdf`,
        mimeType: "application/pdf",
        sourceDocumentKey: `epads_${tenderNumber}_sbd`
      }] : [],
      rawHtml: rawRowHtml
    }));
    const payload = payloads.at(-1);
    if (payload && procurementCategory) payload.procurementCategory = procurementCategory;
  });

  return payloads;
}

function epadsStatusValue($: cheerio.CheerioAPI, cell: cheerio.Cheerio<any>, label: string): string | undefined {
  let value: string | undefined;
  cell.find(".text-uppercase").each((_, element) => {
    if (value || !normalizeWhitespace($(element).text()).toLowerCase().startsWith(label.toLowerCase())) return;
    const badge = normalizeWhitespace($(element).closest("div").find(".badge").first().text());
    if (badge) value = badge;
  });
  return value;
}

function parseFederalEpadsDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = normalizeWhitespace(value).match(
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i
  );
  if (!match) return normalizeDate(value);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf(String(match[1]).toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  if (String(match[6]).toLowerCase() === "pm" && hour < 12) hour += 12;
  if (String(match[6]).toLowerCase() === "am" && hour === 12) hour = 0;
  const pakistanOffsetMinutes = 5 * 60;
  return new Date(Date.UTC(year, month, day, hour, minute) - pakistanOffsetMinutes * 60_000).toISOString();
}

export function parseFederalEpadsDeadline(value: string | undefined, fetchedAt = new Date()): string | undefined {
  const absolute = parseFederalEpadsDate(value);
  if (absolute || !value) return absolute;
  const relative = normalizeWhitespace(value).match(/^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?left$/i);
  if (!relative || (!relative[1] && !relative[2] && !relative[3])) return undefined;
  const milliseconds = (
    Number(relative[1] ?? 0) * 24 * 60
    + Number(relative[2] ?? 0) * 60
    + Number(relative[3] ?? 0)
  ) * 60_000;
  return new Date(fetchedAt.getTime() + milliseconds).toISOString();
}

function federalEpadsPageUrl(baseUrl: string, page: number): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("page", String(page));
  return url.toString();
}

function federalEpadsLastPage(html: string, pageUrl: string): number {
  const $ = cheerio.load(html);
  let lastPage = 1;
  $("a[href*='page=']").each((_, element) => {
    try {
      const page = Number(new URL($(element).attr("href") ?? "", pageUrl).searchParams.get("page"));
      if (Number.isInteger(page) && page > lastPage && page <= 100) lastPage = page;
    } catch {
      // Ignore malformed pagination links and keep the valid page range.
    }
  });
  return lastPage;
}

const federalPpraProfile: SourceProfile = {
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
    rowSelector: "table tbody tr"
  }
};

const federalPpraMaxPages = 100;

export class FederalPpraAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = federalPpraProfile.key;
  readonly name = federalPpraProfile.name;
  readonly sourceType: SourceType = federalPpraProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(federalPpraProfile, context.metadata);
    const firstPageUrl = federalPpraPageUrl(context.baseUrl, 1);
    const firstPage = await fetchPublicText(firstPageUrl, context.userAgent);
    const pageCount = federalPpraPageCount(firstPage.text);
    if (pageCount > federalPpraMaxPages) {
      throw new SourceFetchError(`Federal PPRA reported an unsafe page count (${pageCount}).`);
    }

    const pagePayloads = [parseFederalPpraListing(firstPage.text, firstPageUrl, profile)];
    const remainingPages = await Promise.all(Array.from({ length: pageCount - 1 }, async (_, index) => {
      const page = index + 2;
      await sleep(sourceRuntimeConfig.politeRequestDelayMs * (index + 1));
      const pageUrl = federalPpraPageUrl(context.baseUrl, page);
      const response = await fetchPublicText(pageUrl, context.userAgent);
      const payloads = parseFederalPpraListing(response.text, pageUrl, profile);
      if (!payloads.length) throw new SourceFetchError(`Federal PPRA page ${page} returned no tender rows.`);
      return payloads;
    }));
    pagePayloads.push(...remainingPages);

    const unique = new Map<string, RawTenderPayload>();
    for (const payload of pagePayloads.flat()) {
      unique.set(payload.tenderNumber ?? payload.sourceUrl, payload);
    }
    const listingPayloads = [...unique.values()];
    if (!listingPayloads.length) throw new SourceFetchError("Federal PPRA returned no active tender rows.");

    const detailedPayloads = await Promise.all(listingPayloads.map(async (payload, index) => {
      if (index > 0) await sleep(sourceRuntimeConfig.politeRequestDelayMs * index);
      try {
        const response = await fetchPublicText(payload.sourceUrl, context.userAgent);
        return parseFederalPpraDetail(response.text, payload.sourceUrl, profile, payload);
      } catch (error) {
        payload.sourceMetadata = safeJson({
          ...(payload.sourceMetadata as Record<string, Json>),
          detailFetchStatus: "failed",
          detailFetchError: error instanceof Error ? error.message : String(error)
        });
        return payload;
      }
    }));

    const fetchedDetails = detailedPayloads.filter((payload) => {
      const metadata = metadataRecord(payload.sourceMetadata);
      return metadataString(metadata?.detailFetchStatus) === "fetched";
    }).length;
    if (detailedPayloads.length >= 10 && fetchedDetails / detailedPayloads.length < 0.8) {
      throw new SourceFetchError(`Federal PPRA detail coverage fell below the safe threshold (${fetchedDetails}/${detailedPayloads.length}).`);
    }
    return detailedPayloads;
  }
}

export function parseFederalPpraListing(
  html: string,
  pageUrl: string,
  profile: SourceProfile = federalPpraProfile
): RawTenderPayload[] {
  const $ = cheerio.load(html);
  const payloads: RawTenderPayload[] = [];
  $(profile.listing.rowSelector).each((_, row) => {
    const rowHandle = $(row);
    const cells = rowHandle.find("td");
    if (cells.length < 8) return;

    const tenderNumber = normalizeWhitespace(cells.eq(1).find("strong").first().text()).toUpperCase();
    const detailHref = cells.eq(7).find("a[href*='/public/tenders/tender-details/']").first().attr("href");
    const invoiceHref = cells.eq(7).find("a[href*='/public/tenders/invoice/']").first().attr("href");
    const title = normalizeWhitespace(cells.eq(2).find("div > strong").first().text());
    if (!/^TS[0-9A-Z]+$/i.test(tenderNumber) || !detailHref || !title) return;

    const sourceUrl = normalizeSourceUrl(new URL(detailHref, pageUrl).toString());
    const invoiceUrl = invoiceHref ? normalizeSourceUrl(new URL(invoiceHref, pageUrl).toString()) : undefined;
    const detailBadges = cells.eq(2).find("small.badge").filter((_, element) => !$(element).find(".ri-organization-chart").length);
    const sector = normalizeWhitespace(detailBadges.eq(0).text());
    const agencyReference = normalizeWhitespace(detailBadges.eq(1).text());
    const organization = normalizeWhitespace(cells.eq(3).find(".ri-organization-chart").first().closest("small").text());
    const officeName = normalizeWhitespace(cells.eq(3).find(".tender-org").first().text());
    const location = normalizeWhitespace(cells.eq(3).find(".ri-map-pin-line").first().closest("small").text());
    const [city, ...countryParts] = location.split(/\s+-\s+/);
    const country = normalizeWhitespace(countryParts.join(" - "));
    const sourceStatus = normalizeWhitespace(cells.eq(4).find(".tender-badge").map((_, element) => $(element).text()).get().join("; "));
    const statusDetailHandle = cells.eq(4).clone();
    statusDetailHandle.find(".tender-badge").remove();
    const statusDetail = normalizeWhitespace(statusDetailHandle.text());
    const advertisedText = normalizeWhitespace(cells.eq(5).text());
    const closingText = normalizeWhitespace(cells.eq(6).text());
    const descriptions = cells.eq(2).find("small.text-muted.d-block").map((_, element) => normalizeWhitespace($(element).text())).get();
    const description = [...new Set([title, ...descriptions].filter(Boolean))].join(". ");
    const fallbackDetailDocument: RawTenderPayload["documents"] = [{
      url: sourceUrl,
      filename: `${tenderNumber}-detail.html`,
      mimeType: "text/html",
      sourceDocumentKey: `epms_detail_${tenderNumber}`
    }];
    const payload = buildPayload(profile, {
      sourceUrl,
      title,
      tenderNumber,
      department: organization || officeName || profile.name,
      advertisementDate: parseFederalPpraDate(advertisedText, false),
      closingDate: parseFederalPpraDate(closingText, true),
      city: cleanOptional(city),
      description,
      documents: fallbackDetailDocument,
      sourceStatus,
      websiteUrl: "https://epms.ppra.gov.pk/",
      rawHtml: $.html(rowHandle)
    });
    payload.sourceMetadata = safeJson({
      ...(payload.sourceMetadata as Record<string, Json>),
      listingPageUrl: pageUrl,
      invoiceUrl,
      agencyReference,
      sector,
      officeName,
      country,
      statusDetail,
      detailFetchStatus: "pending"
    });
    payloads.push(payload);
  });
  return payloads;
}

export function parseFederalPpraDetail(
  html: string,
  detailUrl: string,
  profile: SourceProfile,
  listingPayload: RawTenderPayload
): RawTenderPayload {
  const $ = cheerio.load(html);
  const fields = federalPpraDetailFields($);
  const pageTitle = normalizeWhitespace($("h1").first().text());
  const pageTenderNumber = normalizeWhitespace($(".hero p strong").first().text()).toUpperCase();
  if (!pageTitle || !/^TS[0-9A-Z]+$/i.test(pageTenderNumber) || (listingPayload.tenderNumber && pageTenderNumber !== listingPayload.tenderNumber)) {
    throw new SourceFetchError(`Federal PPRA detail page did not match ${listingPayload.tenderNumber ?? detailUrl}.`);
  }
  const title = pageTitle;
  const tenderNumber = pageTenderNumber;
  const organization = federalPpraField(fields, "Organization Name") ?? listingPayload.department;
  const officeName = federalPpraField(fields, "Office Name");
  const officeAddress = federalPpraField(fields, "Office Address");
  const city = federalPpraField(fields, "City") ?? listingPayload.city;
  const contactPerson = normalizeWhitespace([
    federalPpraField(fields, "Contact Person"),
    federalPpraField(fields, "Contact Email"),
    federalPpraField(fields, "Contact Phone")
  ].filter(Boolean).join(" | ")) || listingPayload.contactPerson;
  const agencyReference = federalPpraField(fields, "Tender No / Reference No / Tender Inquiry No");
  const procurementCategory = federalPpraField(fields, "Procurement Category");
  const procurementMethod = federalPpraField(fields, "Procurement Procedure");
  const sector = federalPpraField(fields, "Sector");
  const tenderNature = federalPpraField(fields, "Tender Nature");
  const tenderType = federalPpraField(fields, "Tender Type");
  const advertisementDate = parseFederalPpraDate(federalPpraField(fields, "Advertisement Date"), false) ?? listingPayload.advertisementDate;
  const closingText = federalPpraField(fields, "Closing Date & Time");
  const closingDate = parseFederalPpraDate(closingText, true) ?? listingPayload.closingDate;
  const openingDate = federalPpraOpeningDate(closingText, federalPpraField(fields, "Opening Time"));
  const estimatedValue = parseMoney(federalPpraField(fields, "Estimated Cost"));
  const bidSecurityAmount = parseMoney(federalPpraField(fields, "Bid Security"));
  const documentFee = parseMoney(federalPpraField(fields, "Tender Document Cost"));
  const bidValidity = federalPpraField(fields, "Bid Validity");
  const description = federalPpraSectionText($, "Description") ?? listingPayload.description ?? title;
  const note = federalPpraSectionText($, "Note");
  const corrigenda = $(".corrigendum-item").map((_, element) => normalizeWhitespace($(element).text())).get();
  const detailStatus = normalizeWhitespace($(".badge-corrigendum").first().text());
  const sourceStatus = normalizeWhitespace([listingPayload.sourceStatus, detailStatus].filter(Boolean).join("; "));
  const documents = federalPpraDocuments($, detailUrl, tenderNumber ?? "tender");
  const submissionMethod = inferSubmissionMethod(description);

  const payload = buildPayload(profile, {
    sourceUrl: detailUrl,
    title,
    tenderNumber,
    department: organization,
    advertisementDate,
    closingDate,
    city,
    estimatedValue,
    description: normalizeWhitespace([description, note ? `Note: ${note}` : ""].filter(Boolean).join(". ")),
    documents: documents.length ? documents : listingPayload.documents,
    procurementMethod,
    submissionMethod,
    contactPerson,
    sourceStatus,
    websiteUrl: "https://epms.ppra.gov.pk/",
    rawHtml: html
  });
  if (openingDate) payload.openingDate = openingDate;
  if (bidSecurityAmount !== undefined) payload.bidSecurityAmount = bidSecurityAmount;
  if (documentFee !== undefined) payload.documentFee = documentFee;
  if (procurementCategory) payload.procurementCategory = procurementCategory;
  payload.sourceMetadata = safeJson({
    ...(listingPayload.sourceMetadata as Record<string, Json>),
    ...(payload.sourceMetadata as Record<string, Json>),
    detailFetchStatus: "fetched",
    invoiceUrl: metadataString(metadataRecord(listingPayload.sourceMetadata)?.invoiceUrl),
    agencyReference,
    officeName,
    officeAddress,
    sector,
    tenderNature,
    tenderType,
    bidValidity,
    note,
    corrigenda
  });
  return payload;
}

function federalPpraDetailFields($: cheerio.CheerioAPI): Map<string, string> {
  const fields = new Map<string, string>();
  $(".list-group-item").each((_, element) => {
    const label = federalPpraFieldKey($(element).find(".detail-label").first().text());
    const value = normalizeWhitespace($(element).find(".flex-grow-1, .detail-value").first().text());
    if (label && value && !fields.has(label)) fields.set(label, value);
  });
  return fields;
}

function federalPpraField(fields: Map<string, string>, label: string): string | undefined {
  return fields.get(federalPpraFieldKey(label));
}

function federalPpraFieldKey(value: string): string {
  return normalizeWhitespace(value).replace(/:$/, "").toLowerCase();
}

function federalPpraSectionText($: cheerio.CheerioAPI, heading: string): string | undefined {
  const headingElement = $("h6").filter((_, element) => normalizeWhitespace($(element).text()).toLowerCase() === heading.toLowerCase()).first();
  const value = normalizeWhitespace(headingElement.parent().find(".bg-light").first().text());
  return value || undefined;
}

function federalPpraDocuments($: cheerio.CheerioAPI, detailUrl: string, tenderNumber: string): RawTenderPayload["documents"] {
  const documents: RawTenderPayload["documents"] = [];
  $("a[href*='/pdf?file=']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const url = normalizeSourceUrl(new URL(href, detailUrl).toString());
    const label = normalizeWhitespace($(element).text());
    const kind = /advertisement/i.test(label) ? "advertisement" : "tender";
    const filename = federalPpraPdfFilename(url) ?? `${tenderNumber}-${kind}.pdf`;
    documents.push({
      url,
      filename,
      mimeType: "application/pdf",
      sourceDocumentKey: `epms_${kind}_${filename.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "_")}`
    });
  });
  return dedupeDocuments(documents);
}

function federalPpraPdfFilename(url: string): string | undefined {
  try {
    const encodedPath = new URL(url).searchParams.get("file");
    if (!encodedPath) return undefined;
    const decodedPath = Buffer.from(encodedPath, "base64").toString("utf8");
    return cleanOptional(decodedPath.split(/[\\/]/).filter(Boolean).at(-1));
  } catch {
    return undefined;
  }
}

export function parseFederalPpraDate(value: string | undefined, endOfDayWhenTimeMissing: boolean): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})(?:\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
  if (!match) return undefined;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = monthNames.indexOf(String(match[1]).slice(0, 3).toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!match[4]) {
    if (!endOfDayWhenTimeMissing) return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return new Date(Date.UTC(year, month, day, 18, 59, 59, 999)).toISOString();
  }
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  if (String(match[6]).toLowerCase() === "pm" && hour < 12) hour += 12;
  if (String(match[6]).toLowerCase() === "am" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month, day, hour, minute) - 5 * 60 * 60 * 1000).toISOString();
}

function federalPpraOpeningDate(closingValue: string | undefined, openingValue: string | undefined): string | undefined {
  if (!openingValue) return undefined;
  const absoluteOpening = parseFederalPpraDate(openingValue, false);
  if (absoluteOpening?.includes("T")) return absoluteOpening;
  const datePart = normalizeWhitespace(closingValue ?? "").match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}/i)?.[0];
  return datePart ? parseFederalPpraDate(`${datePart} ${normalizeWhitespace(openingValue)}`, false) : undefined;
}

function federalPpraPageUrl(baseUrl: string, page: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("page", String(page));
  return url.toString();
}

function federalPpraPageCount(html: string): number {
  const body = normalizeWhitespace(cheerio.load(html)("body").text());
  const explicitPageCount = Number(body.match(/Page\s+\d+\s+of\s+(\d+)/i)?.[1]);
  const totalTenders = Number(body.match(/Showing\s+\d+\s+of\s+(\d+)\s+tenders/i)?.[1]);
  const pageCount = Number.isInteger(explicitPageCount) && explicitPageCount > 0
    ? explicitPageCount
    : Number.isInteger(totalTenders) && totalTenders > 0
      ? Math.ceil(totalTenders / 50)
      : 1;
  return Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1;
}

const punjabPpraProfile: SourceProfile = {
  key: "punjab-ppra",
  name: "Punjab PPRA",
  sourceType: "provincial",
  region: "Punjab",
  sourceGroup: "punjab_ppra",
  documentPrefix: "tender_PUNJAB",
  portalFamily: "punjab_ppra",
  knownSourceDomains: ["eproc.punjab.gov.pk", "ppra.punjab.gov.pk", "punjab.eprocure.gov.pk"],
  listing: {
    rowSelector: "#ctl00_ContentPlaceHolderSRIS_rdgrdManageTender_ctl00 tbody > tr.rgRow, #ctl00_ContentPlaceHolderSRIS_rdgrdManageTender_ctl00 tbody > tr.rgAltRow"
  },
  defaultProcurementMethod: "Punjab PPRA public procurement process",
  defaultSubmissionMethod: "As stated in Punjab PPRA notice"
};

type PunjabPpraSession = { cookies: Map<string, string> };

export class PunjabPpraAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = punjabPpraProfile.key;
  readonly name = punjabPpraProfile.name;
  readonly sourceType: SourceType = punjabPpraProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(punjabPpraProfile, context.metadata);
    const pageUrl = new URL("/Admin_Tender_Search.aspx", context.baseUrl).toString();
    const session: PunjabPpraSession = { cookies: new Map() };
    let html = await fetchPunjabPpraPage(pageUrl, context.userAgent, session);
    const payloads = parsePunjabPpraListing(html, pageUrl, profile);
    const initialState = punjabPpraGridState(html);
    if (!payloads.length) throw new SourceFetchError("Punjab PPRA returned no procurement rows.");
    if (initialState.pageCount > 100) throw new SourceFetchError(`Punjab PPRA reported an unsafe page count (${initialState.pageCount}).`);

    let currentPageIndex = initialState.currentPageIndex;
    while (currentPageIndex + 1 < initialState.pageCount) {
      const eventTarget = punjabPpraNextEventTarget(html, currentPageIndex + 2);
      if (!eventTarget) throw new SourceFetchError(`Punjab PPRA page ${currentPageIndex + 1} did not expose a valid next-page postback.`);
      await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      html = await fetchPunjabPpraPage(pageUrl, context.userAgent, session, { html, eventTarget });
      const nextState = punjabPpraGridState(html);
      if (nextState.currentPageIndex <= currentPageIndex) {
        throw new SourceFetchError(`Punjab PPRA pagination did not advance beyond page ${currentPageIndex + 1}.`);
      }
      currentPageIndex = nextState.currentPageIndex;
      payloads.push(...parsePunjabPpraListing(html, pageUrl, profile));
    }

    const unique = new Map<string, RawTenderPayload>();
    for (const payload of payloads) unique.set(payload.sourceUrl, payload);
    return [...unique.values()];
  }
}

export function parsePunjabPpraListing(
  html: string,
  pageUrl: string,
  profile: SourceProfile = punjabPpraProfile
): RawTenderPayload[] {
  const $ = cheerio.load(html);
  const payloads: RawTenderPayload[] = [];
  $(profile.listing.rowSelector).each((_, row) => {
    const rowHandle = $(row);
    const cells = rowHandle.find("td");
    if (cells.length < 9) return;
    const noticeType = normalizeWhitespace(cells.eq(0).text());
    const title = normalizeWhitespace(cells.eq(1).text());
    const procurementCategory = normalizePunjabProcurementCategory(cells.eq(2).text());
    const advertisementDate = parsePunjabPpraDate(cells.eq(3).text(), false);
    const closingDate = parsePunjabPpraDate(cells.eq(4).text(), true);
    const department = normalizeWhitespace(cells.eq(5).text());
    const sourceStatus = normalizeWhitespace(cells.eq(6).text());
    const noticeHref = cells.eq(7).find("a[href]").first().attr("href");
    const biddingHref = cells.eq(8).find("a[href]").first().attr("href");
    if (!title || !noticeHref) return;

    const sourceUrl = normalizeSourceUrl(new URL(noticeHref, pageUrl).toString());
    const documents: RawTenderPayload["documents"] = [
      punjabPpraDocument(sourceUrl, "notice")
    ];
    if (biddingHref) {
      documents.push(punjabPpraDocument(normalizeSourceUrl(new URL(biddingHref, pageUrl).toString()), "bidding"));
    }
    const description = normalizeWhitespace([
      title,
      noticeType ? `Notice type: ${noticeType}` : "",
      procurementCategory ? `Procurement category: ${procurementCategory}` : "",
      department ? `Department: ${department}` : "",
      sourceStatus ? `Source status: ${sourceStatus}` : ""
    ].filter(Boolean).join(". "));

    const payload = buildPayload(profile, {
      sourceUrl,
      title,
      department: department || profile.name,
      advertisementDate,
      closingDate,
      description,
      procurementMethod: profile.defaultProcurementMethod,
      submissionMethod: profile.defaultSubmissionMethod,
      sourceStatus,
      websiteUrl: "https://eproc.punjab.gov.pk/",
      documents,
      rawHtml: $.html(rowHandle)
    });
    if (procurementCategory) payload.procurementCategory = procurementCategory;
    payload.sourceMetadata = safeJson({
      ...(payload.sourceMetadata as Record<string, Json>),
      noticeType,
      sourceStatus
    });
    payloads.push(payload);
  });
  return payloads;
}

function punjabPpraDocument(url: string, kind: "notice" | "bidding"): RawTenderPayload["documents"][number] {
  const filename = filenameFromUrl(url);
  return {
    url,
    filename,
    mimeType: "application/pdf",
    sourceDocumentKey: `punjab_${kind}_${filename.replace(/\.pdf$/i, "")}`
  };
}

function normalizePunjabProcurementCategory(value: string): string | undefined {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (normalized === "work" || normalized === "works") return "Works";
  if (normalized === "goods") return "Goods";
  if (normalized === "service" || normalized === "services") return "Services";
  return normalized ? normalizeWhitespace(value) : undefined;
}

function parsePunjabPpraDate(value: string, endOfDay: boolean): string | undefined {
  const match = normalizeWhitespace(value).match(/^(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})$/i);
  if (!match) return undefined;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = monthNames.indexOf(String(match[2]).slice(0, 3).toLowerCase());
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!endOfDay) return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return new Date(Date.UTC(year, month, day, 18, 59, 59, 999)).toISOString();
}

function punjabPpraGridState(html: string): { currentPageIndex: number; pageCount: number } {
  const currentPageIndex = Number(html.match(/"_currentPageIndex":(\d+)/)?.[1] ?? 0);
  const pageCount = Number(html.match(/"PageCount":(\d+)/)?.[1] ?? 1);
  return {
    currentPageIndex: Number.isInteger(currentPageIndex) && currentPageIndex >= 0 ? currentPageIndex : 0,
    pageCount: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1
  };
}

function punjabPpraNextEventTarget(html: string, nextPageNumber: number): string | undefined {
  const $ = cheerio.load(html);
  const links = $(".rgPager a[href*='__doPostBack']");
  const pageLink = links.filter((_, element) => normalizeWhitespace($(element).text()) === String(nextPageNumber)).first();
  const nextPagesLink = links.filter((_, element) => /next pages/i.test($(element).attr("title") ?? "")).first();
  const href = (pageLink.length ? pageLink : nextPagesLink).attr("href");
  return href?.match(/__doPostBack\('([^']+)'/)?.[1];
}

function punjabPpraPostbackBody(html: string, eventTarget: string): URLSearchParams {
  const $ = cheerio.load(html);
  const body = new URLSearchParams();
  $("form#aspnetForm input[name], form#aspnetForm select[name], form#aspnetForm textarea[name]").each((_, element) => {
    const handle = $(element);
    const name = handle.attr("name");
    if (!name || handle.is(":disabled")) return;
    const type = (handle.attr("type") ?? "").toLowerCase();
    if (["submit", "button", "image", "file"].includes(type)) return;
    if (["checkbox", "radio"].includes(type) && !handle.is(":checked")) return;
    const rawValue = handle.val();
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    body.set(name, String(value ?? ""));
  });
  body.set("__EVENTTARGET", eventTarget);
  body.set("__EVENTARGUMENT", "");
  return body;
}

async function fetchPunjabPpraPage(
  url: string,
  userAgent: string,
  session: PunjabPpraSession,
  postback?: { html: string; eventTarget: string }
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const headers: Record<string, string> = {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      };
      const cookie = [...session.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
      if (cookie) headers.cookie = cookie;
      const init: Record<string, unknown> = {
        method: postback ? "POST" : "GET",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
        dispatcher: insecureAgent
      };
      if (postback) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers.origin = new URL(url).origin;
        headers.referer = url;
        init.body = punjabPpraPostbackBody(postback.html, postback.eventTarget).toString();
      }
      const response = await fetch(url, init as any);
      updatePunjabPpraCookies(session, response);
      const text = await response.text();
      if (!response.ok) throw new SourceFetchError(`Punjab PPRA returned HTTP ${response.status}`);
      if (isInaccessible(text)) throw new PermanentSourceError("Punjab PPRA is not publicly accessible without controls.");
      return text;
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentSourceError || attempt === 2) break;
      await sleep(1_500);
    }
  }
  if (lastError instanceof PermanentSourceError) throw lastError;
  throw new SourceFetchError(lastError instanceof Error ? lastError.message : "Punjab PPRA request failed.");
}

function updatePunjabPpraCookies(session: PunjabPpraSession, response: Response): void {
  const setCookies: string[] = (response.headers as any).getSetCookie?.() ?? [];
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator <= 0) continue;
    session.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

const kpPpraProfile: SourceProfile = {
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
    rowSelector: "table.custom-table > tbody > tr"
  }
};

type KpPpraDetail = {
  tender_id?: string;
  tender_ref?: string;
  tender_start_date?: string;
  tender_close_date?: string;
  tender_file?: string;
  tneder_link?: string;
  bidding_doc?: string;
  bidding_doc_link?: string;
  tender_descp?: string;
  tender_domain?: string | number;
  t_title?: string;
  proc_method_name?: string;
  pkg?: unknown;
  items?: unknown;
  bids?: unknown;
};

export class KpPpraAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = kpPpraProfile.key;
  readonly name = kpPpraProfile.name;
  readonly sourceType: SourceType = kpPpraProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(kpPpraProfile, context.metadata);
    const firstPageUrl = kpPpraPageUrl(context.baseUrl, 1);
    const firstPage = await fetchPublicText(firstPageUrl, context.userAgent);
    const payloads = parseKpPpraListing(firstPage.text, firstPageUrl, profile);
    const lastPage = kpPpraLastPage(firstPage.text);
    if (!payloads.length) throw new SourceFetchError("KP PPRA returned no active tender rows.");
    if (lastPage > 100) throw new SourceFetchError(`KP PPRA reported an unsafe page count (${lastPage}).`);

    for (let page = 2; page <= lastPage; page += 1) {
      await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      const pageUrl = kpPpraPageUrl(context.baseUrl, page);
      const response = await fetchPublicText(pageUrl, context.userAgent);
      payloads.push(...parseKpPpraListing(response.text, pageUrl, profile));
    }

    const unique = new Map<string, RawTenderPayload>();
    for (const payload of payloads) unique.set(payload.sourceUrl, payload);
    return Promise.all([...unique.values()].map(async (payload, index) => {
      const internalTenderId = metadataString(metadataRecord(payload.sourceMetadata)?.internalTenderId);
      if (!internalTenderId) return payload;
      if (index > 0) await sleep(sourceRuntimeConfig.politeRequestDelayMs * index);
      try {
        const detailUrl = kpPpraDetailUrl(context.baseUrl, internalTenderId);
        const response = await fetchPublicText(detailUrl, context.userAgent);
        return applyKpPpraDetail(payload, response.text, detailUrl, profile);
      } catch {
        payload.sourceMetadata = safeJson({
          ...(payload.sourceMetadata as Record<string, Json>),
          detailFetchStatus: "unavailable"
        });
        return payload;
      }
    }));
  }
}

export function parseKpPpraListing(
  html: string,
  pageUrl: string,
  profile: SourceProfile = kpPpraProfile
): RawTenderPayload[] {
  const $ = cheerio.load(html);
  const payloads: RawTenderPayload[] = [];
  $(profile.listing.rowSelector).each((_, row) => {
    const rowHandle = $(row);
    if (/display\s*:\s*none/i.test(rowHandle.attr("style") ?? "")) return;
    const cells = rowHandle.children("td");
    if (cells.length < 8) return;
    const tenderNumber = normalizeWhitespace(cells.eq(0).text());
    const title = normalizeWhitespace(cells.eq(1).text());
    const department = normalizeWhitespace(cells.eq(2).text());
    const internalTenderId = cells.eq(7).find("[onclick*='details(']").attr("onclick")?.match(/details\((\d+)\)/)?.[1];
    if (!/^\d{1,12}$/.test(tenderNumber) || title.length < 4 || !internalTenderId) return;

    const documents: RawTenderPayload["documents"] = [];
    const tenderHref = cells.eq(5).find("a[href]").first().attr("href");
    const biddingHref = cells.eq(6).find("a[href]").first().attr("href");
    if (tenderHref) documents.push(kpPpraDocument(kpPpraDocumentUrl(tenderHref, pageUrl), "notice"));
    if (biddingHref) documents.push(kpPpraDocument(kpPpraDocumentUrl(biddingHref, pageUrl), "bidding"));

    const correction = parseKpPpraCorrectionRow($, rowHandle.next("tr"), pageUrl);
    documents.push(...correction.documents);
    const advertisementDate = parseKpPpraDate(cells.eq(3).text(), false);
    const closingDate = correction.closingDate ?? parseKpPpraDate(cells.eq(4).text(), true);
    const description = normalizeWhitespace([
      title,
      department ? `Procurement entity: ${department}` : "",
      correction.description
    ].filter(Boolean).join(". "));
    const sourceUrl = kpPpraTenderSourceUrl(pageUrl, tenderNumber);
    const payload = buildPayload(profile, {
      sourceUrl,
      title,
      tenderNumber,
      department: department || profile.name,
      advertisementDate,
      closingDate,
      description,
      websiteUrl: kpPpraListingUrl(pageUrl),
      documents,
      rawHtml: $.html(rowHandle) + (correction.rawHtml ?? "")
    });
    payload.sourceMetadata = safeJson({
      ...(payload.sourceMetadata as Record<string, Json>),
      internalTenderId,
      detailEndpoint: kpPpraDetailUrl(pageUrl, internalTenderId),
      detailFetchStatus: "pending",
      hasCorrigendum: Boolean(correction.description)
    });
    payloads.push(payload);
  });
  return payloads;
}

function applyKpPpraDetail(
  payload: RawTenderPayload,
  responseText: string,
  detailUrl: string,
  profile: SourceProfile
): RawTenderPayload {
  const parsed = JSON.parse(responseText) as unknown;
  const detail = Array.isArray(parsed) ? parsed[0] as KpPpraDetail | undefined : undefined;
  if (!detail || String(detail.tender_ref ?? "") !== payload.tenderNumber) {
    throw new SourceFetchError(`KP PPRA returned mismatched detail data for ${payload.tenderNumber ?? detailUrl}.`);
  }
  const documents = [...payload.documents];
  appendKpPpraDetailDocument(documents, detail.tender_file, "notice", detailUrl);
  appendKpPpraDetailDocument(documents, detail.bidding_doc, "bidding", detailUrl);
  const description = normalizeWhitespace(detail.tender_descp ?? payload.description ?? payload.title);
  const procurementCategory = cleanOptional(detail.t_title);
  const procurementMethod = cleanOptional(detail.proc_method_name);
  const advertisementDate = parseKpPpraIsoDate(detail.tender_start_date, false) ?? payload.advertisementDate;
  const closingDate = parseKpPpraIsoDate(detail.tender_close_date, true) ?? payload.closingDate;
  const detailDomain = String(detail.tender_domain ?? "") === "0"
    ? "Local"
    : String(detail.tender_domain ?? "") === "1"
      ? "International"
      : undefined;
  const rawDetail = safeJson({
    tenderId: detail.tender_id,
    tenderNumber: detail.tender_ref,
    tenderType: procurementCategory,
    procurementMethod,
    tenderDomain: detailDomain,
    tenderLink: cleanOptional(detail.tneder_link),
    biddingLink: cleanOptional(detail.bidding_doc_link),
    packages: detail.pkg,
    items: detail.items,
    bids: detail.bids
  });
  const enriched = buildPayload(profile, {
    sourceUrl: payload.sourceUrl,
    title: payload.title,
    tenderNumber: payload.tenderNumber,
    department: payload.department,
    advertisementDate,
    closingDate,
    city: payload.city,
    estimatedValue: payload.estimatedValue,
    description,
    documents,
    procurementMethod,
    submissionMethod: payload.submissionMethod,
    websiteUrl: payload.websiteUrl,
    rawHtml: `${payload.rawSnapshot?.content ?? ""}\n<script type="application/json" data-kp-ppra-detail="${detailUrl}">${escapeHtml(responseText)}</script>`
  });
  if (procurementCategory) enriched.procurementCategory = procurementCategory;
  enriched.sourceMetadata = safeJson({
    ...(payload.sourceMetadata as Record<string, Json>),
    detailFetchStatus: "fetched",
    tenderDomain: detailDomain,
    detail: rawDetail
  });
  return enriched;
}

function parseKpPpraCorrectionRow(
  $: cheerio.CheerioAPI,
  rowHandle: cheerio.Cheerio<any>,
  pageUrl: string
): { description?: string; closingDate?: string; documents: RawTenderPayload["documents"]; rawHtml?: string } {
  if (!/^item_temp_section_/i.test(rowHandle.attr("id") ?? "")) return { documents: [] };
  const descriptions: string[] = [];
  const documents: RawTenderPayload["documents"] = [];
  let closingDate: string | undefined;
  rowHandle.find("table.NOEDITS tr").slice(1).each((_, correctionRow) => {
    const cells = $(correctionRow).children("td");
    if (cells.length < 4) return;
    const description = normalizeWhitespace(cells.eq(1).text());
    if (description) descriptions.push(`Corrigendum: ${description}`);
    closingDate = parseKpPpraDate(cells.eq(2).text(), true) ?? closingDate;
    const href = cells.find("a[href]").first().attr("href");
    if (href) documents.push(kpPpraDocument(kpPpraDocumentUrl(href, pageUrl), "corrigendum"));
  });
  const result: { description?: string; closingDate?: string; documents: RawTenderPayload["documents"]; rawHtml?: string } = {
    documents,
    rawHtml: $.html(rowHandle)
  };
  const description = descriptions.join(". ");
  if (description) result.description = description;
  if (closingDate) result.closingDate = closingDate;
  return result;
}

function kpPpraDocument(url: string, kind: "notice" | "bidding" | "corrigendum"): RawTenderPayload["documents"][number] {
  const normalizedUrl = normalizeSourceUrl(url);
  const filename = kpPpraFilename(normalizedUrl);
  return {
    url: normalizedUrl,
    filename,
    mimeType: mimeFromUrl(filename),
    sourceDocumentKey: `kp_${kind}_${filename.replace(/\.[^.]+$/, "")}`
  };
}

function kpPpraDocumentUrl(href: string, baseUrl: string): string {
  const url = new URL(href, kpPpraPortalUrl("/kppra/", baseUrl));
  url.protocol = "http:";
  url.pathname = url.pathname.replace("/kppra/activetenders.php/staff/", "/kppra/staff/");
  return url.toString();
}

function appendKpPpraDetailDocument(
  documents: RawTenderPayload["documents"],
  filename: string | undefined,
  kind: "notice" | "bidding",
  baseUrl: string
): void {
  const cleanFilename = cleanOptional(filename);
  if (!cleanFilename || documents.some((document) => document.filename === cleanFilename)) return;
  const downloadUrl = new URL("/kppra/staff/force_download.php", baseUrl);
  downloadUrl.searchParams.set("file", `dept/upload/${cleanFilename}`);
  documents.push(kpPpraDocument(downloadUrl.toString(), kind));
}

function kpPpraFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const file = parsed.searchParams.get("file");
    if (file) return decodeURIComponent(file.split("/").filter(Boolean).at(-1) ?? "tender-document");
  } catch {
    // Fall through to the generic filename parser.
  }
  return filenameFromUrl(url);
}

function parseKpPpraDate(value: string, endOfDay: boolean): string | undefined {
  const match = normalizeWhitespace(value).match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/i);
  if (!match) return parseKpPpraIsoDate(value, endOfDay);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return kpPpraDateValue(Number(match[3]), months.indexOf(String(match[2]).toLowerCase()), Number(match[1]), endOfDay);
}

function parseKpPpraIsoDate(value: string | undefined, endOfDay: boolean): string | undefined {
  const match = normalizeWhitespace(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return kpPpraDateValue(Number(match[1]), Number(match[2]) - 1, Number(match[3]), endOfDay);
}

function kpPpraDateValue(year: number, month: number, day: number, endOfDay: boolean): string | undefined {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  if (!endOfDay) return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return new Date(Date.UTC(year, month, day, 18, 59, 59, 999)).toISOString();
}

function kpPpraPageUrl(baseUrl: string, page: number): string {
  const url = kpPpraPortalUrl("/kppra/activetenders.php/", baseUrl);
  if (page > 1) url.searchParams.set("p", String(page));
  return url.toString();
}

function kpPpraListingUrl(baseUrl: string): string {
  return kpPpraPortalUrl("/kppra/activetenders", baseUrl).toString();
}

function kpPpraTenderSourceUrl(baseUrl: string, tenderNumber: string): string {
  const url = kpPpraPortalUrl("/kppra/activetenders.php", baseUrl);
  url.searchParams.set("tender_ref", tenderNumber);
  return url.toString();
}

function kpPpraDetailUrl(baseUrl: string, internalTenderId: string): string {
  const url = kpPpraPortalUrl("/kppra/includes/class.tender.php", baseUrl);
  url.searchParams.set("getTenderDetails", "yes");
  url.searchParams.set("tender_id", internalTenderId);
  return url.toString();
}

function kpPpraPortalUrl(path: string, baseUrl: string): URL {
  const url = new URL(path, baseUrl);
  url.protocol = "http:";
  return url;
}

function kpPpraLastPage(html: string): number {
  const $ = cheerio.load(html);
  const showingText = normalizeWhitespace($("table.custom-table tfoot").text());
  const total = Number(showingText.match(/Showing\s+\d+\s*-\s*\d+\s+of\s+(\d+)/i)?.[1] ?? 0);
  if (Number.isInteger(total) && total > 0) return Math.ceil(total / 25);
  let lastPage = 1;
  $("a[href*='p=']").each((_, element) => {
    try {
      const page = Number(new URL($(element).attr("href") ?? "", "http://kppra.gov.pk").searchParams.get("p"));
      if (Number.isInteger(page) && page > lastPage) lastPage = page;
    } catch {
      // Ignore malformed pager links.
    }
  });
  return lastPage;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const balochistanBppraProfile: SourceProfile = {
  key: "balochistan-bppra",
  name: "Balochistan PPRA",
  sourceType: "provincial",
  region: "Balochistan",
  sourceGroup: "balochistan_bppra",
  documentPrefix: "tender_BALOCHISTAN",
  portalFamily: "balochistan_bppra",
  knownSourceDomains: [
    "bpptwo.vdc.services",
    "bppqa.vdc.services",
    "bppra.gob.pk"
  ],
  listing: {
    rowSelector: "table tbody tr"
  }
};

type BppraTenderRecord = {
  Id?: number;
  PlanningId?: number;
  TSENumber?: string;
  Name?: string;
  TenderName?: string;
  Agency?: string;
  Department?: string;
  District?: string;
  Category?: string;
  ProcurementCategoryID?: number;
  WorksCategoryID?: number;
  TenderStatus?: string;
  PublishedDate?: string;
  CloseDate?: string;
  CloseTime?: string;
  OpenTime?: string;
  RevisedSubmissionLastDate?: string;
  RevisedSubmissionLastTime?: string;
  RevisedBidsOpeningDate?: string;
  RevisedBidsOpeningTime?: string;
  CancelDate?: string;
  CancelReason?: string;
  CorPublished?: string;
  IsRevised?: boolean;
  IsESubmissionAllowed?: boolean;
  IsManual?: boolean;
  PType?: string;
  EstCost?: string;
  DocCost?: string;
  tenderNoticeDoc?: string;
  tenderBidDoc?: string;
  PersonName?: string;
  Designation?: string;
  Address?: string;
  Phone?: string;
  Email?: string;
  EvaluationCriteria?: string;
  evalCriteria?: string;
};

type BppraTenderResponse = {
  status?: boolean;
  TotalPages?: number;
  tenders?: BppraTenderRecord[];
};

type BppraPlanResponse = {
  Succeeded?: boolean;
  Data?: {
    Objects?: Array<{ ObjectClass?: string; Method?: string }>;
  };
};

const bppraApiBaseUrl = "https://bpptwo.vdc.services:9446";
const bppraPortalUrl = "https://bpptwo.vdc.services:5451/Tenders";
const bppraRecordsPerPage = 100;
const bppraAdvertisementLookbackDays = 400;
const bppraMaxApiPages = 300;
const bppraPageConcurrency = 3;

export class BalochistanBppraAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = balochistanBppraProfile.key;
  readonly name = balochistanBppraProfile.name;
  readonly sourceType: SourceType = balochistanBppraProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(balochistanBppraProfile, context.metadata);
    const dateRange = bppraAdvertisementDateRange(new Date());
    const firstPageUrl = bppraApiPageUrl(1, dateRange);
    const [firstPage, methodMap] = await Promise.all([
      fetchBppraJson<BppraTenderResponse>(firstPageUrl, context.userAgent),
      fetchBppraMethodMap(context.userAgent)
    ]);
    if (firstPage.status !== true || !Array.isArray(firstPage.tenders)) {
      throw new SourceFetchError("Balochistan PPRA returned an invalid tender response.");
    }
    const totalRecords = Number(firstPage.TotalPages ?? firstPage.tenders.length);
    const pageCount = Math.max(1, Math.ceil(totalRecords / bppraRecordsPerPage));
    if (!Number.isInteger(pageCount) || pageCount > bppraMaxApiPages) {
      throw new SourceFetchError(`Balochistan PPRA reported an unsafe page count (${pageCount}).`);
    }

    const remainingPages: BppraTenderRecord[][] = [];
    const pageNumbers = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    for (let offset = 0; offset < pageNumbers.length; offset += bppraPageConcurrency) {
      if (offset > 0) await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      const batch = pageNumbers.slice(offset, offset + bppraPageConcurrency);
      const batchRecords = await Promise.all(batch.map(async (page) => {
        const pageUrl = bppraApiPageUrl(page, dateRange);
        const response = await fetchBppraJson<BppraTenderResponse>(pageUrl, context.userAgent);
        if (response.status !== true || !Array.isArray(response.tenders)) {
          throw new SourceFetchError(`Balochistan PPRA returned an invalid response for page ${page}.`);
        }
        return response.tenders;
      }));
      remainingPages.push(...batchRecords);
    }

    const records = [firstPage.tenders, ...remainingPages].flat();
    const unique = new Map<number, BppraTenderRecord>();
    for (const record of records) {
      if (!record.Id || !bppraTenderIsCurrent(record, dateRange.to)) continue;
      unique.set(record.Id, record);
    }
    const payloads = [...unique.values()].map((record) => buildBppraPayload(record, profile, methodMap));
    if (!payloads.length) throw new SourceFetchError("Balochistan PPRA returned no current tender rows.");
    return payloads;
  }
}

function buildBppraPayload(
  record: BppraTenderRecord,
  profile: SourceProfile,
  methodMap: Map<string, string>
): RawTenderPayload {
  const tenderNumber = cleanOptional(record.TSENumber);
  const title = cleanOptional(record.TenderName) ?? cleanOptional(record.Name);
  if (!record.Id || !tenderNumber || !title) {
    throw new SourceFetchError("Balochistan PPRA returned a tender without a stable ID, TSE number, or title.");
  }
  const procurementCategory = bppraProcurementCategory(record.ProcurementCategoryID);
  const procurementMethod = methodMap.get(normalizeWhitespace(record.Category ?? "").toLowerCase());
  const advertisementDate = bppraAdvertisementDate(record.PublishedDate);
  const closingDate = parseBppraDeadline(
    record.RevisedSubmissionLastDate ?? record.CloseDate,
    record.RevisedSubmissionLastTime ?? record.CloseTime,
    true
  );
  const openingDate = parseBppraDeadline(
    record.RevisedBidsOpeningDate ?? record.RevisedSubmissionLastDate ?? record.CloseDate,
    record.RevisedBidsOpeningTime ?? record.OpenTime,
    false
  );
  const estimatedValue = bppraNumber(record.EstCost);
  const documentFee = bppraNumber(record.DocCost);
  const submissionMethod = bppraSubmissionMethod(record);
  const contactPerson = normalizeWhitespace([
    record.PersonName,
    record.Designation,
    record.Phone,
    record.Email
  ].filter(Boolean).join(" | ")) || undefined;
  const documents = bppraDocuments(record, tenderNumber);
  const sourceUrl = new URL(bppraPortalUrl);
  sourceUrl.searchParams.set("search", tenderNumber);
  const description = normalizeWhitespace([
    title,
    record.Category ? `Object: ${record.Category}` : "",
    record.Agency ? `Procuring agency: ${record.Agency}` : "",
    record.Department ? `Department: ${record.Department}` : "",
    record.District ? `District: ${record.District}` : "",
    record.TenderStatus ? `Source status: ${record.TenderStatus}` : "",
    record.CancelReason ? `Cancellation reason: ${record.CancelReason}` : ""
  ].filter(Boolean).join(". "));
  const payload = buildPayload(profile, {
    sourceUrl: sourceUrl.toString(),
    title,
    tenderNumber,
    department: cleanOptional(record.Agency) ?? cleanOptional(record.Department) ?? profile.name,
    advertisementDate,
    closingDate,
    city: cleanOptional(record.District),
    estimatedValue,
    description,
    documents,
    procurementMethod,
    submissionMethod,
    contactPerson,
    sourceStatus: cleanOptional(record.TenderStatus),
    websiteUrl: bppraPortalUrl,
    rawHtml: `<script type="application/json" data-bppra-tender-id="${record.Id}">${escapeHtml(JSON.stringify(record))}</script>`
  });
  if (openingDate) payload.openingDate = openingDate;
  if (documentFee !== undefined) payload.documentFee = documentFee;
  if (procurementCategory) payload.procurementCategory = procurementCategory;
  payload.sourceMetadata = safeJson({
    ...(payload.sourceMetadata as Record<string, Json>),
    bppraTenderId: record.Id,
    planningId: record.PlanningId,
    parentDepartment: record.Department,
    classOfObject: record.Category,
    evaluationCriteria: record.EvaluationCriteria ?? record.evalCriteria,
    isElectronicSubmissionAllowed: record.IsESubmissionAllowed,
    isManual: record.IsManual,
    tenderType: record.PType,
    isRevised: record.IsRevised,
    corrigendumPublished: record.CorPublished,
    cancelDate: record.CancelDate,
    cancelReason: record.CancelReason
  });
  payload.rawSnapshot = {
    content: JSON.stringify(record),
    contentType: "application/json; charset=utf-8",
    extension: "json"
  };
  return payload;
}

function bppraDocuments(record: BppraTenderRecord, tenderNumber: string): RawTenderPayload["documents"] {
  if (!record.Id) return [];
  const documents: RawTenderPayload["documents"] = [];
  const attachments = [
    [cleanOptional(record.tenderBidDoc), "bidding"],
    [cleanOptional(record.tenderNoticeDoc), "notice"]
  ] as const;
  for (const [attachment, kind] of attachments) {
    if (!attachment || !isBinaryTenderAttachment(attachment)) continue;
    const attachmentUrl = new URL(`/Images/${attachment.replace(/^\/+/, "")}`, bppraApiBaseUrl).toString();
    documents.push({
      url: attachmentUrl,
      filename: attachment.split("/").filter(Boolean).at(-1) ?? `${tenderNumber}-boq.pdf`,
      mimeType: mimeFromUrl(attachment),
      sourceDocumentKey: `bppra_${kind}_${record.Id}`
    });
  }
  return dedupeDocuments(documents);
}

function isBinaryTenderAttachment(value: string): boolean {
  return /\.(?:pdf|docx|jpe?g|png|tiff?|webp)(?:$|[?#])/i.test(value);
}

function bppraProcurementCategory(value: number | undefined): string | undefined {
  if (value === 1) return "Goods";
  if (value === 2) return "Services";
  if (value === 3) return "Works";
  if (value === 4) return "Consulting Services";
  return undefined;
}

function bppraSubmissionMethod(record: BppraTenderRecord): string | undefined {
  if (record.IsESubmissionAllowed && record.IsManual) return "Electronic and manual bidding";
  if (record.IsESubmissionAllowed) return "Electronic bidding";
  if (record.IsManual) return "Manual bidding";
  return undefined;
}

export function parseBppraDeadline(
  dateValue: string | undefined,
  timeValue: string | undefined,
  endOfDayWhenTimeMissing: boolean
): string | undefined {
  const date = bppraCalendarDate(dateValue);
  if (!date) return undefined;
  const time = bppraTimeParts(timeValue);
  if (!time) {
    if (!endOfDayWhenTimeMissing) return undefined;
    return new Date(Date.UTC(date.year, date.month, date.day, 18, 59, 59, 999)).toISOString();
  }
  return new Date(Date.UTC(date.year, date.month, date.day, time.hour, time.minute) - 5 * 60 * 60 * 1000).toISOString();
}

function bppraCalendarDate(value: string | undefined): { year: number; month: number; day: number } | undefined {
  const normalized = normalizeWhitespace(value ?? "");
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const year = Number(iso?.[1] ?? us?.[3]);
  const month = Number(iso?.[2] ?? us?.[1]) - 1;
  const day = Number(iso?.[3] ?? us?.[2]);
  const date = new Date(Date.UTC(year, month, day));
  if (!Number.isFinite(year) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

function bppraTimeParts(value: string | undefined): { hour: number; minute: number } | undefined {
  if (!value) return undefined;
  const milliseconds = Number(value.match(/\d{10,13}/)?.[0]);
  if (Number.isFinite(milliseconds) && milliseconds > 0) {
    const date = new Date(milliseconds < 10_000_000_000 ? milliseconds * 1000 : milliseconds);
    if (!Number.isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Karachi",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date);
      const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
      const hour = part("hour");
      const minute = part("minute");
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
    }
  }
  const time = normalizeWhitespace(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!time) return undefined;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  if (time[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (time[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : undefined;
}

function bppraAdvertisementDate(value: string | undefined): string | undefined {
  const date = bppraCalendarDate(value);
  return date ? `${date.year}-${String(date.month + 1).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : undefined;
}

function bppraNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numericText = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0];
  const number = Number(numericText);
  return Number.isFinite(number) ? number : undefined;
}

function bppraTenderIsCurrent(record: BppraTenderRecord, pakistanToday: string): boolean {
  const closing = bppraCalendarDate(record.RevisedSubmissionLastDate ?? record.CloseDate);
  if (!closing) return true;
  const closingDate = `${closing.year}-${String(closing.month + 1).padStart(2, "0")}-${String(closing.day).padStart(2, "0")}`;
  return closingDate >= pakistanToday;
}

function bppraAdvertisementDateRange(now: Date): { from: string; to: string } {
  const to = pakistanCalendarDate(now);
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - bppraAdvertisementLookbackDays);
  return { from: end.toISOString().slice(0, 10), to };
}

function pakistanCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function bppraApiPageUrl(page: number, dateRange: { from: string; to: string }): string {
  const model = encodeURIComponent(JSON.stringify({
    AgenciesArray: [],
    ObjectArray: [],
    ProcMethodArray: [],
    DistrictArray: [],
    DepartmentArray: [],
    PSDPArray: [],
    MinCost: 0,
    MaxCost: 0,
    YearId: 0,
    From: dateRange.from,
    To: dateRange.to
  }));
  return `${bppraApiBaseUrl}/api/LatestTenders/Get_AllTenderDNN/${page}/${bppraRecordsPerPage}/tenders/null/null//0//0//0//null/null/?model=${model}`;
}

async function fetchBppraMethodMap(userAgent: string): Promise<Map<string, string>> {
  try {
    const response = await fetchBppraJson<BppraPlanResponse>(`${bppraApiBaseUrl}/api/DnnPlan/get`, userAgent);
    const result = new Map<string, string>();
    for (const object of response.Data?.Objects ?? []) {
      const name = normalizeWhitespace(object.ObjectClass ?? "").toLowerCase();
      const method = normalizeWhitespace(object.Method ?? "");
      if (name && method && !result.has(name)) result.set(name, method);
    }
    return result;
  } catch {
    return new Map();
  }
}

async function fetchBppraJson<T>(url: string, userAgent: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": userAgent,
          accept: "application/json"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
        dispatcher: insecureAgent
      } as any);
      const text = await response.text();
      if (!response.ok) throw new SourceFetchError(`Balochistan PPRA returned HTTP ${response.status}.`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await sleep(1_500);
    }
  }
  throw new SourceFetchError(lastError instanceof Error ? lastError.message : "Balochistan PPRA request failed.");
}

const sindhPpraProfile: SourceProfile = {
  key: "sindh-sppra",
  name: "Sindh SPPRA",
  sourceType: "provincial",
  region: "Sindh",
  sourceGroup: "sindh_sppra",
  documentPrefix: "tender_SINDH",
  portalFamily: "sindh_sppra",
  knownSourceDomains: [
    "portalsindh.eprocure.gov.pk",
    "apiprd.eprocure.gov.pk",
    "pprasindh.gov.pk",
    "e.pprasindh.gov.pk",
    "epads.pprasindh.gov.pk",
    "sindh.eprocure.gov.pk"
  ],
  listing: {
    rowSelector: "section"
  },
  defaultSubmissionMethod: "Electronic via Sindh EPADS"
};

const kpEprocureProfile: SourceProfile = {
  key: "kp-eprocure",
  name: "KP eProcure",
  sourceType: "provincial",
  region: "Khyber Pakhtunkhwa",
  sourceGroup: "kp_eprocure",
  documentPrefix: "tender_KP_EPROCURE",
  portalFamily: "kp_eprocure",
  knownSourceDomains: ["portalkp.eprocure.gov.pk", "apiprd.eprocure.gov.pk", "kp.eprocure.gov.pk", "kppra.gov.pk"],
  listing: { rowSelector: "section" },
  defaultSubmissionMethod: "Electronic via KP EPADS"
};

type SindhPpraTenderRecord = {
  publishedDocumentID?: number;
  tR_DocumentTemplateID?: number;
  procurementPlansDetailID?: number;
  name?: string;
  description?: string;
  documentId?: number;
  documentGUID?: string | null;
  ppraTenderNumber?: string | null;
  tenderNumber?: string;
  tenderNumbers?: string;
  isPublished?: boolean;
  isInternationalPublish?: boolean;
  officeID?: number;
  publishDate?: string;
  lastSubmissionDate?: string;
  bidOpeningDate?: string;
  bidValidityDate?: string;
  clarificationDate?: string;
  departmentName?: string;
  statusName?: string;
  location?: string;
  voilation?: string | null;
  procurementCategory?: string | null;
  bidSubmissionType?: number;
  estimatedCost?: string | number | null;
  procurementMethod?: string | null;
  procurementProcedure?: string | null;
};

type SindhPpraDocumentRecord = {
  dmS_FileID?: number;
  dmS_FileGUID?: string;
  tr_PublishedDocumentID?: number;
  tR_DocumentTemplateID?: number;
  documentTemplateName?: string;
  procurementPlansDetailID?: number;
  publishedDocumentID?: number;
  publishDate?: string;
  isCorrigendum?: number;
};

type SindhPpraApiResponse<T> = {
  data?: T;
  success?: boolean;
  responseMessage?: string;
};

type SindhPpraListingData = {
  totalRecords?: number;
  totalPages?: number;
  records?: SindhPpraTenderRecord[];
};

type SindhPpraDocumentLookup = {
  primary: SindhPpraDocumentRecord[];
  publications: SindhPpraDocumentRecord[];
  primarySucceeded: boolean;
  publicationsSucceeded: boolean;
  errors: string[];
};

const sindhPpraPortalUrl = "https://portalsindh.eprocure.gov.pk/";
const sindhPpraApiBaseUrl = "https://apiprd.eprocure.gov.pk/websiteportal/publicportal/1.0.0/api/v1/publicportal";
const sindhPpraDownloadUrl = "https://apiprd.eprocure.gov.pk/documentmanagementsystem/dmspublicapi/1.0.0/api/v1/dmspublicapi/downloadportalfilebyguid";
const sindhPpraOfficeId = 31640;
const sindhPpraPageSize = 500;
const sindhPpraMaxPages = 20;
const sindhPpraDocumentConcurrency = 5;

type EprocurePortalConfig = {
  label: string;
  portalUrl: string;
  officeId: number;
  officeDetail: string;
  documentKeyPrefix: string;
  pageSize: number;
  maxPages: number;
  documentConcurrency: number;
};

const sindhEprocureConfig: EprocurePortalConfig = {
  label: "Sindh SPPRA",
  portalUrl: sindhPpraPortalUrl,
  officeId: sindhPpraOfficeId,
  officeDetail: "Sindh-PPRA-Dev",
  documentKeyPrefix: "sindh_sppra",
  pageSize: sindhPpraPageSize,
  maxPages: sindhPpraMaxPages,
  documentConcurrency: sindhPpraDocumentConcurrency
};

const kpEprocureConfig: EprocurePortalConfig = {
  label: "KP eProcure",
  portalUrl: "https://portalkp.eprocure.gov.pk/",
  officeId: 31603,
  officeDetail: "KPK-PPRA-Dev",
  documentKeyPrefix: "kp_eprocure",
  // The public UI renders 10 cards but the underlying public endpoint accepts 500.
  // This keeps the complete current-tender scan polite and bounded.
  pageSize: 500,
  maxPages: 60,
  documentConcurrency: 5
};

export class SindhPpraAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = sindhPpraProfile.key;
  readonly name = sindhPpraProfile.name;
  readonly sourceType: SourceType = sindhPpraProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    return fetchEprocureTenders(sindhPpraProfile, sindhEprocureConfig, context);
  }
}

export class KpEprocureAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;
  readonly key = kpEprocureProfile.key;
  readonly name = kpEprocureProfile.name;
  readonly sourceType: SourceType = kpEprocureProfile.sourceType;

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    return fetchEprocureTenders(kpEprocureProfile, kpEprocureConfig, context);
  }
}

async function fetchEprocureTenders(
  sourceProfile: SourceProfile,
  portal: EprocurePortalConfig,
  context: SourceAdapterContext
): Promise<RawTenderPayload[]> {
    const profile = resolveProfileMetadata(sourceProfile, context.metadata);
    const firstPage = await fetchSindhPpraListingPage(1, context.userAgent, portal);
    const firstRecords = firstPage.data?.records;
    if (firstPage.success !== true || !Array.isArray(firstRecords)) {
      throw new SourceFetchError("Sindh SPPRA returned an invalid tender-list response.");
    }
    const reportedPages = Number(firstPage.data?.totalPages);
    const totalRecords = Number(firstPage.data?.totalRecords ?? firstRecords.length);
    const pageCount = Number.isInteger(reportedPages) && reportedPages > 0
      ? reportedPages
      : Math.max(1, Math.ceil(totalRecords / portal.pageSize));
    if (!Number.isInteger(pageCount) || pageCount > portal.maxPages) {
      throw new SourceFetchError(`${portal.label} reported an unsafe page count (${pageCount}).`);
    }

    const pageRecords = [firstRecords];
    for (let page = 2; page <= pageCount; page += 1) {
      await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      const response = await fetchSindhPpraListingPage(page, context.userAgent, portal);
      if (response.success !== true || !Array.isArray(response.data?.records)) {
        throw new SourceFetchError(`${portal.label} returned an invalid response for page ${page}.`);
      }
      pageRecords.push(response.data.records);
    }

    const now = new Date();
    const unique = new Map<string, SindhPpraTenderRecord>();
    for (const record of pageRecords.flat()) {
      const key = sindhPpraRecordKey(record);
      if (!key || !sindhPpraTenderIsCurrent(record, now)) continue;
      unique.set(key, record);
    }
    const currentRecords = [...unique.values()];
    if (!currentRecords.length) throw new SourceFetchError("Sindh SPPRA returned no complete, currently open tender rows.");

    const payloads: RawTenderPayload[] = [];
    let primaryLookupSuccesses = 0;
    for (let offset = 0; offset < currentRecords.length; offset += portal.documentConcurrency) {
      const batch = currentRecords.slice(offset, offset + portal.documentConcurrency);
      const batchResults = await Promise.all(batch.map(async (record) => {
        const lookup = await fetchSindhPpraDocumentLookup(record, context.userAgent, portal);
        if (lookup.primarySucceeded && lookup.primary.some(sindhPpraDocumentIsUsable)) primaryLookupSuccesses += 1;
        return buildSindhPpraPayload(record, lookup, profile, portal);
      }));
      payloads.push(...batchResults);
      if (offset + portal.documentConcurrency < currentRecords.length) {
        await sleep(sourceRuntimeConfig.politeRequestDelayMs);
      }
    }

    if (currentRecords.length >= 10 && primaryLookupSuccesses / currentRecords.length < 0.8) {
      throw new SourceFetchError(`${portal.label} bidding-document lookup coverage fell below the safe threshold (${primaryLookupSuccesses}/${currentRecords.length}).`);
    }
    return payloads;
}

function sindhPpraListingRequest(page: number, portal: EprocurePortalConfig): Record<string, unknown> {
  return {
    pagination: {
      pageNumber: String(page),
      pageSize: String(portal.pageSize),
      orderBy: "",
      orderByColumnName: "PublishedDate",
      approvalStatusID: 0,
      refTypeID: 0
    },
    filter: {
      sortOrder: "PublishedDate",
      activityStatus: "In-Progress",
      keywords: "",
      tenderNo: "",
      departmentName: null,
      dateOfAdvertisement: null,
      closingDate: null,
      selectedWorth: null
    },
    loggedInUserID: 1,
    loggedInUserOfficeID: portal.officeId
  };
}

async function fetchSindhPpraListingPage(page: number, userAgent: string, portal: EprocurePortalConfig): Promise<SindhPpraApiResponse<SindhPpraListingData>> {
  return fetchSindhPpraJson<SindhPpraApiResponse<SindhPpraListingData>>(
    `${sindhPpraApiBaseUrl}/getallpublictenders`,
    sindhPpraListingRequest(page, portal), userAgent, portal
  );
}

async function fetchSindhPpraDocumentLookup(record: SindhPpraTenderRecord, userAgent: string, portal: EprocurePortalConfig): Promise<SindhPpraDocumentLookup> {
  const publishedDocumentId = Number(record.publishedDocumentID);
  if (!Number.isInteger(publishedDocumentId) || publishedDocumentId <= 0) {
    return {
      primary: [],
      publications: [],
      primarySucceeded: false,
      publicationsSucceeded: false,
      errors: ["Tender did not include a publishedDocumentID."]
    };
  }
  const request = {
    Id: publishedDocumentId,
    loggedInUserID: 1,
    loggedInUserOfficeID: portal.officeId
  };
  const publicationRequest = {
    ...request,
    SupplierID: 1,
    procurementPlansDetailID: record.procurementPlansDetailID ?? null
  };
  const [primaryResult, publicationResult] = await Promise.allSettled([
    fetchSindhPpraJson<SindhPpraApiResponse<SindhPpraDocumentRecord[]>>(
      `${sindhPpraApiBaseUrl}/getallpublisheddocumentdetailbypdid`,
      request,
      userAgent, portal
    ),
    fetchSindhPpraJson<SindhPpraApiResponse<SindhPpraDocumentRecord[]>>(
      `${sindhPpraApiBaseUrl}/getallpublisheddocumentdetailbypdidpublication`,
      publicationRequest,
      userAgent, portal
    )
  ]);
  const primarySucceeded = primaryResult.status === "fulfilled" && primaryResult.value.success === true && Array.isArray(primaryResult.value.data);
  const publicationsSucceeded = publicationResult.status === "fulfilled" && publicationResult.value.success === true && Array.isArray(publicationResult.value.data);
  const errors: string[] = [];
  if (!primarySucceeded) errors.push(sindhPpraLookupError("bidding documents", primaryResult));
  if (!publicationsSucceeded) errors.push(sindhPpraLookupError("PA publications", publicationResult));
  return {
    primary: primarySucceeded ? primaryResult.value.data ?? [] : [],
    publications: publicationsSucceeded ? publicationResult.value.data ?? [] : [],
    primarySucceeded,
    publicationsSucceeded,
    errors
  };
}

function sindhPpraLookupError(
  label: string,
  result: PromiseSettledResult<SindhPpraApiResponse<SindhPpraDocumentRecord[]>>
): string {
  if (result.status === "rejected") {
    return `${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
  }
  return `${label}: ${result.value.responseMessage || "source returned an invalid response"}`;
}

function buildSindhPpraPayload(
  record: SindhPpraTenderRecord,
  lookup: SindhPpraDocumentLookup,
  profile: SourceProfile,
  portal: EprocurePortalConfig
): RawTenderPayload {
  const tenderNumber = cleanOptional(record.tenderNumbers) ?? cleanOptional(record.tenderNumber);
  const title = cleanOptional(record.name);
  const department = cleanOptional(record.departmentName);
  const advertisementDate = sindhPpraCalendarDate(record.publishDate);
  const closingDate = parseSindhPpraDateTime(record.lastSubmissionDate);
  if (!tenderNumber || !title || !department || !advertisementDate || !closingDate) {
    throw new SourceFetchError("Sindh SPPRA returned a current tender without its required identity, title, department, publication date, or closing date.");
  }
  const openingDate = parseSindhPpraDateTime(record.bidOpeningDate);
  const estimatedValue = parseMoney(record.estimatedCost === null || record.estimatedCost === undefined ? undefined : String(record.estimatedCost));
  const procurementMethod = cleanOptional(record.procurementProcedure ?? undefined) ?? cleanOptional(record.procurementMethod ?? undefined);
  const sourceUrl = new URL(portal.portalUrl);
  sourceUrl.searchParams.set("tenderNo", tenderNumber);
  const primaryDocuments = lookup.primary
    .map((document) => sindhPpraDocument(document, tenderNumber, "bidding", portal))
    .filter((document): document is NonNullable<typeof document> => Boolean(document));
  const publicationDocuments = lookup.publications
    .map((document) => sindhPpraDocument(document, tenderNumber, document.isCorrigendum ? "corrigendum" : "publication", portal))
    .filter((document): document is NonNullable<typeof document> => Boolean(document));
  const unusableDocumentDetails = lookup.primary.length + lookup.publications.length - primaryDocuments.length - publicationDocuments.length;
  const documentLookupErrors = [
    ...lookup.errors,
    ...(unusableDocumentDetails > 0 ? [`Source returned ${unusableDocumentDetails} document record(s) without a usable file ID or GUID.`] : [])
  ];
  const documents = dedupeDocuments([...primaryDocuments, ...publicationDocuments]);
  const description = normalizeWhitespace([
    record.description || title,
    `Tender number: ${tenderNumber}`,
    `Department: ${department}`,
    record.location ? `Location: ${record.location}` : "",
    record.statusName ? `Source status: ${record.statusName}` : "",
    openingDate ? `Bid opening: ${openingDate}` : "",
    record.bidValidityDate ? `Bid validity: ${record.bidValidityDate}` : "",
    record.voilation ? `Source warning: ${record.voilation}` : ""
  ].filter(Boolean).join(". "));
  const payload = buildPayload(profile, {
    sourceUrl: sourceUrl.toString(),
    title,
    tenderNumber,
    department,
    advertisementDate,
    closingDate,
    city: cleanOptional(record.location),
    estimatedValue,
    description,
    documents,
    procurementMethod,
    sourceStatus: cleanOptional(record.statusName),
    websiteUrl: portal.portalUrl,
    rawHtml: `<script type="application/json" data-eprocure-published-document-id="${record.publishedDocumentID ?? ""}">${escapeHtml(JSON.stringify(record))}</script>`
  });
  if (openingDate) payload.openingDate = openingDate;
  if (record.procurementCategory) payload.procurementCategory = normalizeWhitespace(record.procurementCategory);
  const snapshot = {
    record,
    biddingDocuments: lookup.primary.map(sindhPpraDocumentSnapshot),
    paPublishedDocuments: lookup.publications.map(sindhPpraDocumentSnapshot),
    documentLookupErrors
  };
  payload.raw = safeJson({
    ...snapshot,
    sourceType: profile.sourceType,
    adapterKey: profile.key,
    fetchedAt: new Date().toISOString()
  });
  payload.rawSnapshot = {
    content: JSON.stringify(snapshot),
    contentType: "application/json; charset=utf-8",
    extension: "json"
  };
  payload.sourceMetadata = safeJson({
    ...(payload.sourceMetadata as Record<string, Json>),
    publishedDocumentId: record.publishedDocumentID,
    documentTemplateId: record.tR_DocumentTemplateID,
    procurementPlansDetailId: record.procurementPlansDetailID,
    officeId: record.officeID ?? portal.officeId,
    sourceTenderNumber: record.tenderNumber,
    sourceStatus: record.statusName,
    bidValidityDate: sindhPpraCalendarDate(record.bidValidityDate),
    clarificationDate: parseSindhPpraDateTime(record.clarificationDate),
    isInternational: record.isInternationalPublish,
    violation: record.voilation,
    bidSubmissionType: record.bidSubmissionType,
    primaryDocumentLookup: lookup.primarySucceeded ? "fetched" : "failed",
    publicationLookup: lookup.publicationsSucceeded ? "fetched" : "failed",
    documentLookupErrors,
    biddingDocumentCount: primaryDocuments.length,
    paPublicationCount: publicationDocuments.length,
    reportedBiddingDocumentCount: lookup.primary.length,
    reportedPaPublicationCount: lookup.publications.length
  });
  return payload;
}

function sindhPpraDocumentSnapshot(record: SindhPpraDocumentRecord): SindhPpraDocumentRecord {
  const snapshot: SindhPpraDocumentRecord = {};
  if (record.dmS_FileID !== undefined) snapshot.dmS_FileID = record.dmS_FileID;
  if (record.dmS_FileGUID !== undefined) snapshot.dmS_FileGUID = record.dmS_FileGUID;
  if (record.tr_PublishedDocumentID !== undefined) snapshot.tr_PublishedDocumentID = record.tr_PublishedDocumentID;
  if (record.tR_DocumentTemplateID !== undefined) snapshot.tR_DocumentTemplateID = record.tR_DocumentTemplateID;
  if (record.documentTemplateName !== undefined) snapshot.documentTemplateName = record.documentTemplateName;
  if (record.procurementPlansDetailID !== undefined) snapshot.procurementPlansDetailID = record.procurementPlansDetailID;
  if (record.publishedDocumentID !== undefined) snapshot.publishedDocumentID = record.publishedDocumentID;
  if (record.publishDate !== undefined) snapshot.publishDate = record.publishDate;
  if (record.isCorrigendum !== undefined) snapshot.isCorrigendum = record.isCorrigendum;
  return snapshot;
}

function sindhPpraDocument(
  record: SindhPpraDocumentRecord,
  tenderNumber: string,
  kind: "bidding" | "publication" | "corrigendum",
  portal: EprocurePortalConfig
): RawTenderPayload["documents"][number] | undefined {
  const fileId = Number(record.dmS_FileID);
  const guid = cleanOptional(record.dmS_FileGUID);
  if (!Number.isInteger(fileId) || fileId <= 0 || !guid) return undefined;
  const url = new URL(sindhPpraDownloadUrl);
  url.searchParams.set("fileId", String(fileId));
  url.searchParams.set("guid", guid);
  const templateName = cleanOptional(record.documentTemplateName) ?? kind;
  return {
    url: url.toString(),
    filename: `${sindhPpraFilenamePart(tenderNumber)}-${sindhPpraFilenamePart(templateName)}.pdf`,
    mimeType: "application/pdf",
    sourceDocumentKey: `${portal.documentKeyPrefix}_${kind}_${fileId}`,
    downloadRequest: {
      method: "POST",
      headers: sindhPpraPublicHeaders(portal),
      body: safeJson({
        loggedInUserOfficeID: portal.officeId,
        loggedInUserID: 1,
        ID: fileId,
        idsList: guid
      }),
      responseFormat: "json_base64"
    }
  };
}

function sindhPpraDocumentIsUsable(record: SindhPpraDocumentRecord): boolean {
  const fileId = Number(record.dmS_FileID);
  return Number.isInteger(fileId) && fileId > 0 && Boolean(cleanOptional(record.dmS_FileGUID));
}

function sindhPpraFilenamePart(value: string): string {
  return normalizeWhitespace(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "document";
}

function sindhPpraRecordKey(record: SindhPpraTenderRecord): string | undefined {
  const publishedDocumentId = Number(record.publishedDocumentID);
  if (Number.isInteger(publishedDocumentId) && publishedDocumentId > 0) return `published:${publishedDocumentId}`;
  const tenderNumber = cleanOptional(record.tenderNumbers) ?? cleanOptional(record.tenderNumber);
  return tenderNumber ? `tender:${tenderNumber.toLowerCase()}` : undefined;
}

function sindhPpraTenderIsCurrent(record: SindhPpraTenderRecord, now: Date): boolean {
  if (normalizeWhitespace(record.statusName ?? "").toLowerCase() !== "in-progress") return false;
  if (!sindhPpraRecordKey(record) || !cleanOptional(record.name) || !cleanOptional(record.departmentName) || !sindhPpraCalendarDate(record.publishDate)) return false;
  const closingDate = parseSindhPpraDateTime(record.lastSubmissionDate);
  return Boolean(closingDate && Date.parse(closingDate) >= now.getTime());
}

function sindhPpraCalendarDate(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match || match[1] === "0001") return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseSindhPpraDateTime(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
  if (!match || match[1] === "0001") return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const local = new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month || local.getUTCDate() !== day) return undefined;
  return new Date(local.getTime() - 5 * 60 * 60 * 1000).toISOString();
}

function sindhPpraPublicHeaders(portal: EprocurePortalConfig = sindhEprocureConfig): Record<string, string> {
  return {
    authorization: "Basic YWRtaW46cHByYTEy",
    "content-type": "application/json",
    officedetail: portal.officeDetail,
    origin: portal.portalUrl.slice(0, -1),
    referer: portal.portalUrl
  };
}

async function fetchSindhPpraJson<T>(url: string, body: Record<string, unknown>, userAgent: string, portal: EprocurePortalConfig = sindhEprocureConfig): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...sindhPpraPublicHeaders(portal),
          "user-agent": userAgent,
          accept: "application/json"
        },
        body: JSON.stringify(body),
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
        dispatcher: insecureAgent
      } as any);
      const text = await response.text();
      if (!response.ok) throw new SourceFetchError(`${portal.label} returned HTTP ${response.status}.`);
      const parsed = JSON.parse(text) as SindhPpraApiResponse<unknown>;
      if (parsed.success !== true) throw new SourceFetchError(parsed.responseMessage || `${portal.label} rejected the public API request.`);
      return parsed as T;
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await sleep(1_500);
    }
  }
  throw new SourceFetchError(lastError instanceof Error ? lastError.message : `${portal.label} request failed.`);
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
  new FederalEpadsAdapter(),
  new FederalPpraAdapter(),
  new PunjabPpraAdapter(),
  new SindhPpraAdapter(),
  new KpEprocureAdapter(),
  new KpPpraAdapter(),
  new BalochistanBppraAdapter(),
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

export async function fetchBinary(
  url: string,
  userAgent = defaultUserAgent,
  downloadRequest?: RawTenderPayload["documents"][number]["downloadRequest"]
): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string; filename?: string | undefined }> {
  try {
    const response = await fetch(url, {
      method: downloadRequest?.method ?? "GET",
      headers: {
        "user-agent": userAgent,
        accept: "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,text/html,*/*",
        ...downloadRequest?.headers
      },
      body: downloadRequest ? JSON.stringify(downloadRequest.body) : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(sourceRuntimeConfig.documentFetchTimeoutMs),
      dispatcher: insecureAgent
    } as any);
    if (downloadRequest?.responseFormat === "json_base64") {
      const responseText = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          buffer: Buffer.from(responseText),
          contentType: response.headers.get("content-type") ?? "application/json"
        };
      }
      const envelope = JSON.parse(responseText) as {
        success?: boolean;
        data?: { bytes?: string; contentType?: string; fileName?: string };
      };
      const bytes = envelope.data?.bytes;
      const buffer = bytes ? Buffer.from(bytes, "base64") : Buffer.alloc(0);
      return {
        ok: envelope.success === true && buffer.length > 0,
        status: response.status,
        buffer,
        contentType: envelope.data?.contentType ?? "application/octet-stream",
        filename: cleanOptional(envelope.data?.fileName)
      };
    }
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
    sourceStatus: cleanOptional(input.sourceStatus),
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
