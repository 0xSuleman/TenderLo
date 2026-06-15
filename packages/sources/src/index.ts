import * as cheerio from "cheerio";
import {
  SourceFetchError,
  normalizeWhitespace,
  safeJson,
  sourceRuntimeConfig,
  type RawTenderPayload,
  type SourceAdapter,
  type SourceAdapterContext,
  type SourceType
} from "@tenderlo/shared";

const defaultUserAgent = "TenderLoBot/0.1 (+https://tenderlo.local; polite contractor tender indexing)";

const inaccessiblePatterns = [
  /captcha/i,
  /login required/i,
  /sign in/i,
  /subscribe to continue/i,
  /paywall/i,
  /access denied/i,
  /forbidden/i
];

export class GenericHtmlTenderAdapter implements SourceAdapter {
  readonly respectsRobotsTxt = true;

  constructor(
    public readonly key: string,
    public readonly name: string,
    public readonly sourceType: SourceType,
    private readonly options: {
      linkSelector?: string;
      titleSelector?: string;
      departmentSelector?: string;
      region?: string;
    } = {}
  ) {}

  async fetchTenders(context: SourceAdapterContext): Promise<RawTenderPayload[]> {
    const listing = await fetchText(context.baseUrl, context.userAgent);
    if (!listing.ok || isInaccessible(listing.text)) return [];

    const $ = cheerio.load(listing.text);
    const links = collectTenderLinks($, context.baseUrl, this.options.linkSelector);
    const payloads: RawTenderPayload[] = [];

    for (const link of links.slice(0, sourceRuntimeConfig.maxLinksPerSourceRun)) {
      const detail = await fetchText(link.url, context.userAgent);
      if (!detail.ok || isInaccessible(detail.text)) continue;
      const detailOptions: {
        titleFallback: string;
        sourceName: string;
        sourceType: SourceType;
        titleSelector?: string;
        departmentSelector?: string;
        region?: string;
      } = {
        titleFallback: link.title,
        sourceName: context.sourceName,
        sourceType: this.sourceType
      };
      if (this.options.titleSelector) detailOptions.titleSelector = this.options.titleSelector;
      if (this.options.departmentSelector) detailOptions.departmentSelector = this.options.departmentSelector;
      if (this.options.region) detailOptions.region = this.options.region;
      const payload = parseDetailPage(detail.text, link.url, detailOptions);
      if (payload) payloads.push(payload);
      await sleep(sourceRuntimeConfig.politeRequestDelayMs);
    }

    return payloads;
  }
}

export class GenericNewspaperAdapter extends GenericHtmlTenderAdapter {
  constructor(key: string, name: string, options: { linkSelector?: string; titleSelector?: string; region?: string } = {}) {
    super(key, name, "newspaper", options);
  }
}

export const sourceAdapters: SourceAdapter[] = [
  new GenericHtmlTenderAdapter("federal-epads", "Federal EPADS", "federal", {
    linkSelector: "a",
    titleSelector: "h1, h2, .title, .tender-title",
    departmentSelector: ".department, .organization, .procuring-agency",
    region: "Pakistan"
  }),
  new GenericHtmlTenderAdapter("federal-ppra-active", "Federal PPRA Active Tenders", "federal", {
    linkSelector: "a",
    titleSelector: "h1, h2, .title, .tender-title",
    departmentSelector: ".department, .agency, .organization",
    region: "Pakistan"
  }),
  new GenericHtmlTenderAdapter("punjab-ppra", "Punjab PPRA", "provincial", {
    linkSelector: "a",
    region: "Punjab"
  }),
  new GenericHtmlTenderAdapter("sindh-sppra", "Sindh SPPRA", "provincial", {
    linkSelector: "a",
    region: "Sindh"
  }),
  new GenericHtmlTenderAdapter("kp-tenders", "KP Public Tenders", "provincial", {
    linkSelector: "a",
    region: "Khyber Pakhtunkhwa"
  }),
  new GenericHtmlTenderAdapter("balochistan-public-procurement", "Balochistan Public Procurement", "provincial", {
    linkSelector: "a",
    region: "Balochistan"
  }),
  new GenericNewspaperAdapter("business-recorder-tenders", "Business Recorder Tenders", {
    linkSelector: "a",
    region: "Pakistan"
  }),
  new GenericNewspaperAdapter("jang-epaper-public", "Jang Public E-Paper", {
    linkSelector: "a",
    region: "Pakistan"
  }),
  new GenericNewspaperAdapter("dawn-public-tenders", "Dawn Public Tender Notices", {
    linkSelector: "a",
    region: "Pakistan"
  }),
  new GenericNewspaperAdapter("the-news-public-tenders", "The News Public Tender Notices", {
    linkSelector: "a",
    region: "Pakistan"
  }),
  new GenericNewspaperAdapter("express-public-tenders", "Express Public Tender Notices", {
    linkSelector: "a",
    region: "Pakistan"
  }),
  new GenericNewspaperAdapter("nawaiwaqt-public-tenders", "Nawa-i-Waqt Public Tender Notices", {
    linkSelector: "a",
    region: "Pakistan"
  }),
  new GenericNewspaperAdapter("the-nation-public-tenders", "The Nation Public Tender Notices", {
    linkSelector: "a",
    region: "Pakistan"
  })
];

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
}): SourceAdapterContext {
  return {
    sourceId: source.id,
    sourceName: source.name,
    baseUrl: source.base_url,
    adapterKey: source.adapter_key,
    userAgent: process.env.TENDERLO_USER_AGENT ?? defaultUserAgent
  };
}

export async function fetchText(url: string, userAgent = defaultUserAgent): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
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

export async function fetchBinary(url: string, userAgent = defaultUserAgent): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,text/html,*/*"
      },
      redirect: "follow"
    });
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

function collectTenderLinks($: cheerio.CheerioAPI, baseUrl: string, selector = "a"): Array<{ url: string; title: string }> {
  const links: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  $(selector).each((_, element) => {
    const href = $(element).attr("href");
    const title = normalizeWhitespace($(element).text());
    if (!href || !title) return;
    const lower = `${href} ${title}`.toLowerCase();
    if (!/(tender|procurement|quotation|bid|notice|classified|epaper|e-paper|auction|work order|open procurement)/.test(lower)) return;
    const url = new URL(href, baseUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ url, title: title.slice(0, 500) });
  });
  return links;
}

function parseDetailPage(
  html: string,
  sourceUrl: string,
  options: {
    titleFallback: string;
    sourceName: string;
    sourceType: SourceType;
    titleSelector?: string;
    departmentSelector?: string;
    region?: string;
  }
): RawTenderPayload | null {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  const title =
    normalizeWhitespace(options.titleSelector ? $(options.titleSelector).first().text() : "") ||
    normalizeWhitespace($("h1").first().text()) ||
    normalizeWhitespace($("title").first().text()) ||
    options.titleFallback;
  const body = normalizeWhitespace($("main").text() || $("article").text() || $("body").text());
  if (!title || body.length < 30) return null;

  const department = normalizeWhitespace(options.departmentSelector ? $(options.departmentSelector).first().text() : "") || inferDepartment(body);
  const documents = collectDocumentLinks($, sourceUrl);

  const payload: RawTenderPayload = {
    sourceUrl,
    title,
    department: department || options.sourceName,
    description: body.slice(0, 4000),
    documents,
    raw: safeJson({
      title,
      body: body.slice(0, 20_000),
      sourceType: options.sourceType,
      fetchedAt: new Date().toISOString()
    }),
    rawSnapshot: {
      content: html,
      contentType: "text/html; charset=utf-8",
      extension: "html"
    }
  };
  if (options.region && options.region !== "Pakistan") payload.province = options.region;
  if (options.sourceType === "newspaper") {
    payload.newspaperName = options.sourceName;
    const publicationDate = inferPublicationDate(body);
    const pageSection = inferPageSection(body);
    if (publicationDate) payload.publicationDate = publicationDate;
    if (pageSection) payload.pageSection = pageSection;
  }
  return payload;
}

function collectDocumentLinks($: cheerio.CheerioAPI, sourceUrl: string): RawTenderPayload["documents"] {
  const documents: RawTenderPayload["documents"] = [];
  const seen = new Set<string>();
  $("a").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const lower = href.toLowerCase();
    if (!/\.(pdf|docx?|png|jpe?g|tiff?|webp)(\?|$)/.test(lower)) return;
    const url = new URL(href, sourceUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);
    documents.push({
      url,
      filename: decodeURIComponent(url.split("/").pop() ?? "tender-document"),
      mimeType: mimeFromUrl(url)
    });
  });
  return documents;
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

function inferDepartment(text: string): string | undefined {
  const match = text.match(/\b(?:department|authority|ministry|office of|directorate|division)\s*[:\-]?\s*([A-Z][A-Za-z&,\s.-]{4,100})/);
  return match?.[1] ? normalizeWhitespace(match[1]) : undefined;
}

function inferPublicationDate(text: string): string | undefined {
  const match = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
  return match?.[1];
}

function inferPageSection(text: string): string | undefined {
  const match = text.match(/\b(classifieds?|tenders?|business|city|national)\b/i);
  return match?.[1] ? normalizeWhitespace(match[1]) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
