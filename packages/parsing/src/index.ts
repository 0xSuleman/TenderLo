import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import { logger, normalizeWhitespace, parsingRuntimeConfig, type ParseDocumentInput, type ParseDocumentResult, type ParsedDocumentPage } from "@tenderlo/shared";

const execFileAsync = promisify(execFile);

export async function parseDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  try {
    if (isHtml(input.mimeType, input.filename)) {
      return parseHtmlDocument(input.buffer.toString("utf8"));
    }
    if (isDocx(input.mimeType, input.filename)) {
      return parseDocxDocument(input.buffer);
    }
    if (isPdf(input.mimeType, input.filename)) {
      const parsed = await parsePdfDocument(input.buffer);
      if (parsed.pages.some((page) => page.text.length > parsingRuntimeConfig.minPdfTextCharsBeforeOcr)) return parsed;
      logger.info("PDF text extraction produced too little text; starting OCR fallback.", { sourceUrl: input.sourceUrl, filename: input.filename });
      return runOcr(input);
    }
    if (isImage(input.mimeType, input.filename)) {
      return runOcr(input);
    }
    return {
      parserStatus: "failed",
      ocrStatus: "not_needed",
      pages: [],
      pageCount: 0,
      errorMessage: `Unsupported tender document type: ${input.mimeType || input.filename || "unknown"}`
    };
  } catch (error) {
    logger.error("Document parsing failed.", {
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      mimeType: input.mimeType,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      parserStatus: "failed",
      ocrStatus: "failed",
      pages: [],
      pageCount: 0,
      errorMessage: error instanceof Error ? error.message : "Unknown parsing error"
    };
  }
}

export function parseHtmlDocument(html: string, selector?: string): ParseDocumentResult {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  const selectedText = selector ? $(selector).text() : "";
  const genericText = $("main").text() || $("article").text() || $("body").text() || $.root().text();
  const text = normalizeWhitespace(selectedText || genericText);
  if (!text) {
    return {
      parserStatus: "failed",
      ocrStatus: "not_needed",
      pages: [],
      pageCount: 0,
      errorMessage: "No extractable HTML text found"
    };
  }
  return {
    parserStatus: "parsed",
    ocrStatus: "not_needed",
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text,
        extractionMethod: selector ? "html_selector" : "html_generic",
        confidenceScore: selector ? parsingRuntimeConfig.confidence.htmlSelector : parsingRuntimeConfig.confidence.htmlGeneric
      }
    ]
  };
}

export async function parseDocxDocument(buffer: Buffer): Promise<ParseDocumentResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = normalizeWhitespace(result.value);
  if (!text) {
    return {
      parserStatus: "failed",
      ocrStatus: "not_needed",
      pages: [],
      pageCount: 0,
      errorMessage: "No extractable DOCX text found"
    };
  }
  return {
    parserStatus: "parsed",
    ocrStatus: "not_needed",
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text,
        extractionMethod: "docx_text",
        confidenceScore: parsingRuntimeConfig.confidence.docxText
      }
    ]
  };
}

export async function parsePdfDocument(buffer: Buffer): Promise<ParseDocumentResult> {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const data = await pdfParse(buffer);
  const pages = splitPdfTextIntoPages(data.text || "");
  return {
    parserStatus: pages.length ? "parsed" : "ocr_required",
    ocrStatus: pages.length ? "not_needed" : "pending",
    pageCount: data.numpages ?? pages.length,
    pages
  };
}

export async function runOcr(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const workdir = await mkdtemp(join(tmpdir(), "tenderlo-ocr-"));
  const extension = extensionFor(input.mimeType, input.filename);
  const inputPath = join(workdir, `document${extension}`);
  try {
    await writeFile(inputPath, input.buffer);
    logger.info("Starting local Tesseract OCR.", { sourceUrl: input.sourceUrl, filename: input.filename });
    const { stdout } = await execFileAsync("tesseract", [inputPath, "stdout", "-l", "eng"], {
      timeout: parsingRuntimeConfig.ocrTimeoutMs,
      maxBuffer: parsingRuntimeConfig.ocrMaxBufferBytes
    });
    const text = normalizeWhitespace(stdout);
    if (!text) {
      return {
        parserStatus: "failed",
        ocrStatus: "failed",
        pageCount: 0,
        pages: [],
        errorMessage: "Tesseract completed but returned no OCR text"
      };
    }
    return {
      parserStatus: "parsed",
      ocrStatus: "completed",
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          text,
          extractionMethod: "ocr",
          confidenceScore: parsingRuntimeConfig.confidence.ocrFallback
        }
      ]
    };
  } catch (error) {
    logger.error("Local OCR failed.", {
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      parserStatus: "failed",
      ocrStatus: "failed",
      pageCount: 0,
      pages: [],
      errorMessage: error instanceof Error ? error.message : "OCR failed"
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export function mergeParsedPages(pages: ParsedDocumentPage[]): string {
  return normalizeWhitespace(
    pages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page) => page.text)
      .join("\n\n")
  );
}

function splitPdfTextIntoPages(text: string): ParsedDocumentPage[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized || normalized.length < 20) return [];
  const chunks = normalized.split(/\f/g).filter((chunk) => normalizeWhitespace(chunk).length > 20);
  const pageTexts = chunks.length ? chunks : [normalized];
  return pageTexts.map((page, index) => ({
    pageNumber: index + 1,
    text: normalizeWhitespace(page),
    extractionMethod: "pdf_text",
    confidenceScore: parsingRuntimeConfig.confidence.pdfText
  }));
}

function extensionFor(mimeType: string, filename?: string): string {
  const fromFilename = filename ? extname(filename) : "";
  if (fromFilename) return fromFilename;
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("tiff")) return ".tiff";
  return ".bin";
}

function isHtml(mimeType: string, filename?: string): boolean {
  return mimeType.includes("html") || filename?.toLowerCase().endsWith(".html") === true || filename?.toLowerCase().endsWith(".htm") === true;
}

function isPdf(mimeType: string, filename?: string): boolean {
  return mimeType.includes("pdf") || filename?.toLowerCase().endsWith(".pdf") === true;
}

function isDocx(mimeType: string, filename?: string): boolean {
  return mimeType.includes("wordprocessingml") || filename?.toLowerCase().endsWith(".docx") === true;
}

function isImage(mimeType: string, filename?: string): boolean {
  const lower = filename?.toLowerCase() ?? "";
  return mimeType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"].some((extension) => lower.endsWith(extension));
}
