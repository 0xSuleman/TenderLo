import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import { logger, normalizeWhitespace, parsingRuntimeConfig, type ParseDocumentInput, type ParseDocumentResult, type ParsedDocumentPage } from "@tenderlo/shared";

const execFileAsync = promisify(execFile);
let availableTesseractLanguages: string[] | null = null;
let openCvPreprocessingAvailable: boolean | null = null;

const openCvPreprocessor = [
  "import cv2, sys",
  "image = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE)",
  "if image is None: raise RuntimeError('OpenCV could not read the image')",
  "denoised = cv2.fastNlMeansDenoising(image, None, 10, 7, 21)",
  "enhanced = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(denoised)",
  "processed = cv2.adaptiveThreshold(enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11)",
  "if not cv2.imwrite(sys.argv[2], processed): raise RuntimeError('OpenCV could not write the processed image')"
].join("\n");

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
      return runPdfOcr(input);
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
    const ocrInputPath = await preprocessOcrImage(inputPath, workdir, input);
    logger.info("Starting local Tesseract OCR.", { sourceUrl: input.sourceUrl, filename: input.filename });
    const languages = await resolveTesseractLanguages(input);
    const { stdout } = await execFileAsync("tesseract", [ocrInputPath, "stdout", "-l", languages], {
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

export async function runPdfOcr(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const workdir = await mkdtemp(join(tmpdir(), "tenderlo-pdf-ocr-"));
  const inputPath = join(workdir, "document.pdf");
  const outputPrefix = join(workdir, "page");
  try {
    await writeFile(inputPath, input.buffer);
    await execFileAsync(
      "pdftoppm",
      ["-f", "1", "-l", String(parsingRuntimeConfig.ocrMaxPdfPages), "-r", "200", "-png", inputPath, outputPrefix],
      {
        timeout: parsingRuntimeConfig.ocrTimeoutMs,
        maxBuffer: parsingRuntimeConfig.ocrMaxBufferBytes
      }
    );

    const pageFiles = (await readdir(workdir))
      .filter((file) => /^page-\d+\.png$/.test(file))
      .sort((left, right) => Number(left.match(/\d+/)?.[0] ?? 0) - Number(right.match(/\d+/)?.[0] ?? 0));
    if (pageFiles.length === 0) {
      return {
        parserStatus: "failed",
        ocrStatus: "failed",
        pageCount: 0,
        pages: [],
        errorMessage: "PDF OCR conversion produced no page images"
      };
    }

    const languages = await resolveTesseractLanguages(input);
    const pages: ParsedDocumentPage[] = [];
    for (const [index, pageFile] of pageFiles.entries()) {
      const pagePath = join(workdir, pageFile);
      const ocrInputPath = await preprocessOcrImage(pagePath, workdir, input);
      const { stdout } = await execFileAsync("tesseract", [ocrInputPath, "stdout", "-l", languages], {
        timeout: parsingRuntimeConfig.ocrTimeoutMs,
        maxBuffer: parsingRuntimeConfig.ocrMaxBufferBytes
      });
      const text = normalizeWhitespace(stdout);
      if (!text) continue;
      pages.push({
        pageNumber: index + 1,
        text,
        extractionMethod: "ocr",
        confidenceScore: parsingRuntimeConfig.confidence.ocrFallback
      });
    }

    if (pages.length === 0) {
      return {
        parserStatus: "failed",
        ocrStatus: "failed",
        pageCount: pageFiles.length,
        pages: [],
        errorMessage: "Tesseract completed but returned no OCR text"
      };
    }

    return {
      parserStatus: "parsed",
      ocrStatus: "completed",
      pageCount: pageFiles.length,
      pages
    };
  } catch (error) {
    logger.error("Local PDF OCR failed.", {
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      parserStatus: "failed",
      ocrStatus: "failed",
      pageCount: 0,
      pages: [],
      errorMessage: error instanceof Error ? error.message : "PDF OCR failed"
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function preprocessOcrImage(inputPath: string, workdir: string, input: ParseDocumentInput): Promise<string> {
  if (openCvPreprocessingAvailable === false) return inputPath;
  const outputPath = join(workdir, `preprocessed-${Math.random().toString(36).slice(2)}.png`);
  try {
    await execFileAsync(process.env.TENDERLO_PYTHON_COMMAND || "python", ["-c", openCvPreprocessor, inputPath, outputPath], {
      timeout: Math.min(parsingRuntimeConfig.ocrTimeoutMs, 30_000),
      maxBuffer: parsingRuntimeConfig.ocrMaxBufferBytes
    });
    openCvPreprocessingAvailable = true;
    return outputPath;
  } catch (error) {
    openCvPreprocessingAvailable = false;
    logger.warn("OpenCV preprocessing is unavailable; using the original image for local Tesseract OCR.", {
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      error: error instanceof Error ? error.message : String(error)
    });
    return inputPath;
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

async function resolveTesseractLanguages(input: ParseDocumentInput): Promise<string> {
  const requested = parsingRuntimeConfig.tesseractLanguages.split("+").map((language) => language.trim()).filter(Boolean);
  const available = await listTesseractLanguages();
  const usable = requested.filter((language) => available.includes(language));
  if (usable.length === requested.length && usable.length > 0) return usable.join("+");
  if (usable.length > 0) {
    logger.warn("Some configured Tesseract languages are not installed; using available subset.", {
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      requested: parsingRuntimeConfig.tesseractLanguages,
      using: usable.join("+")
    });
    return usable.join("+");
  }
  if (available.includes("eng")) {
    logger.warn("Configured Tesseract languages are not installed; falling back to eng.", {
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      requested: parsingRuntimeConfig.tesseractLanguages
    });
    return "eng";
  }
  return parsingRuntimeConfig.tesseractLanguages;
}

async function listTesseractLanguages(): Promise<string[]> {
  if (availableTesseractLanguages) return availableTesseractLanguages;
  try {
    const { stdout, stderr } = await execFileAsync("tesseract", ["--list-langs"], { timeout: 5_000 });
    availableTesseractLanguages = `${stdout}\n${stderr}`
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line && !line.toLowerCase().startsWith("list of available languages"));
  } catch {
    availableTesseractLanguages = [];
  }
  return availableTesseractLanguages;
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
