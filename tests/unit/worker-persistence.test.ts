import { describe, expect, it } from "vitest";
import type { RawTenderPayload } from "@tenderlo/shared";
import {
  appendFederalEstimatedValueLowerBound,
  buildSourceProvenance,
  buildTenderDocumentStoragePath,
  buildTenderFieldPromotion,
  circuitOpenUntilFor,
  retryDelaySeconds,
  validateDownloadedDocument,
  validateNewTenderAdmission,
  validateSourcePayload
} from "../../apps/worker/src/jobs";

describe("worker tender persistence helpers", () => {
  it("builds deterministic source-prefixed private document storage paths", () => {
    expect(buildTenderDocumentStoragePath({
      adapterKey: "kp-ppra-active",
      documentPrefix: "tender_kppra",
      tenderId: "00000000-0000-4000-8000-000000000123",
      hash: "abc123",
      filename: "Tender Notice (Final).pdf"
    })).toBe("kp-ppra-active/tender_kppra/00000000-0000-4000-8000-000000000123/abc123-Tender-Notice-Final-.pdf");
  });

  it("flags unexpected original source domains for manual QA review", () => {
    const payload: RawTenderPayload = {
      sourceUrl: "https://www.kppra.gov.pk/kppra/activetenders",
      title: "Rehabilitation of water supply scheme in Peshawar",
      sourceGroup: "kp_kppra",
      sourceLabel: "Khyber Pakhtunkhwa PPRA",
      originalSourceUrl: "https://epads.pprasindh.gov.pk/tenders/77",
      websiteUrl: "https://epads.pprasindh.gov.pk/",
      sourceMetadata: {
        portalFamily: "kp_kppra",
        documentPrefix: "tender_kppra",
        knownSourceDomains: ["kppra.gov.pk", "portal.kppra.gov.pk", "kp.eprocure.gov.pk"]
      },
      documents: [],
      raw: {}
    };

    const provenance = buildSourceProvenance({
      adapter_key: "kp-ppra-active",
      metadata: {
        sourceGroup: "kp_kppra",
        portalFamily: "kp_kppra",
        documentPrefix: "tender_kppra",
        knownSourceDomains: ["kppra.gov.pk", "portal.kppra.gov.pk", "kp.eprocure.gov.pk"]
      }
    }, payload);

    expect(provenance.sourceGroup).toBe("kp_kppra");
    expect(provenance.documentPrefix).toBe("tender_kppra");
    expect(provenance.originalSourceHost).toBe("epads.pprasindh.gov.pk");
    expect(provenance.originalSourceDomainKnown).toBe(false);
  });

  it("promotes only high-confidence document fields into empty automated tender columns", () => {
    const updates = buildTenderFieldPromotion(
      { is_human_verified: false, closing_date: "2026-07-20T18:59:59.999Z", opening_date: null, bid_security_amount: null, city: null },
      [
        { fieldName: "closing_date", fieldValue: "2026-07-21T05:00:00.000Z", sourceMethod: "keyword_window", confidenceScore: 0.94, evidenceText: "Closing", verificationStatus: "unverified" },
        { fieldName: "opening_date", fieldValue: "2026-07-20T05:30:00.000Z", sourceMethod: "keyword_window", confidenceScore: 0.94, evidenceText: "Opening", verificationStatus: "unverified" },
        { fieldName: "bid_security_amount", fieldValue: "500000", sourceMethod: "keyword_window", confidenceScore: 0.9, evidenceText: "Bid security", verificationStatus: "unverified" },
        { fieldName: "city", fieldValue: "Islamabad", sourceMethod: "keyword_window", confidenceScore: 0.62, evidenceText: "Boilerplate", verificationStatus: "needs_review" }
      ]
    );

    expect(updates).toEqual({ closing_date: "2026-07-21T05:00:00.000Z", opening_date: "2026-07-20T05:30:00.000Z", bid_security_amount: 500000 });
    expect(buildTenderFieldPromotion({ is_human_verified: true, bid_security_amount: null }, [
      { fieldName: "bid_security_amount", fieldValue: "500000", sourceMethod: "keyword_window", confidenceScore: 0.9, evidenceText: "Bid security", verificationStatus: "unverified" }
    ])).toEqual({});
    expect(buildTenderFieldPromotion({ is_human_verified: false, bid_security_amount: 2_200_000 }, [
      { fieldName: "bid_security_amount", fieldValue: "1200000", sourceMethod: "table_rule", confidenceScore: 0.94, evidenceText: "Lot 1", verificationStatus: "unverified" }
    ])).toEqual({ bid_security_amount: 1_200_000 });
  });

  it("accepts genuine HTTP portal files and rejects HTML disguised as a PDF", () => {
    expect(validateDownloadedDocument({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      contentType: "image/jpg",
      filename: "1784266143nit.jpg"
    })).toBeNull();
    expect(validateDownloadedDocument({
      buffer: Buffer.from("<html>download error</html>"),
      contentType: "text/html",
      filename: "bidding-document.pdf"
    })).toMatch(/not downloadable tender documents/i);
    expect(validateDownloadedDocument({
      buffer: Buffer.from("<html>portal page</html>"),
      contentType: "text/html; charset=UTF-8",
      filename: "procurement-detail.html"
    })).toMatch(/not downloadable tender documents/i);
  });

  it("derives only a labelled federal estimated-value lower bound from bid security", () => {
    const fields = appendFederalEstimatedValueLowerBound([
      { fieldName: "bid_security_amount", fieldValue: "500000", sourceMethod: "keyword_window", confidenceScore: 0.9, evidenceText: "Bid security Rs. 500,000", verificationStatus: "unverified" }
    ]);
    expect(fields.find((field) => field.fieldName === "estimated_value_lower_bound")?.fieldValue).toBe("10000000");
    expect(fields.find((field) => field.fieldName === "estimated_value_summary")?.fieldValue).toContain("exact estimate not published");
    expect(appendFederalEstimatedValueLowerBound([
      { fieldName: "estimated_value", fieldValue: "12000000", sourceMethod: "regex", confidenceScore: 0.9, evidenceText: "Estimated value", verificationStatus: "unverified" }
    ])).toHaveLength(1);
  });

  it("admits only current, core-complete tenders that advertise a document", () => {
    const currentTender: RawTenderPayload = {
      sourceUrl: "https://epads.gov.pk/opportunities/federal/procurements/53111",
      title: "Procurement of audit services",
      tenderNumber: "P53111",
      department: "Peshawar Electric Supply Company",
      advertisementDate: "2026-07-17T07:40:00+05:00",
      closingDate: "2026-07-20T10:00:00+05:00",
      documents: [{ url: "https://epads.gov.pk/api/bidding-document/53111", filename: "bidding-document.pdf" }],
      raw: {}
    };

    expect(validateNewTenderAdmission(currentTender, new Date("2026-07-18T00:00:00+05:00"))).toEqual([]);
    expect(validateNewTenderAdmission(
      { ...currentTender, department: undefined, closingDate: "2026-07-17T10:00:00+05:00", documents: [] },
      new Date("2026-07-18T00:00:00+05:00")
    )).toEqual(expect.arrayContaining([
      "Procuring department is missing.",
      "Tender closing date has already passed.",
      "No primary tender document was advertised by the source."
    ]));
  });

  it("rejects malformed adapter payloads before persistence and snapshots", () => {
    expect(validateSourcePayload({
      sourceUrl: "not-a-url",
      title: "",
      documents: [{ url: "also-not-a-url" }],
      raw: {}
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("sourceUrl"),
      expect.stringContaining("title"),
      expect.stringContaining("documents.0.url")
    ]));
  });

  it("uses bounded exponential retry and circuit-open delays", () => {
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(120);
    expect(retryDelaySeconds(20)).toBe(86_400);
    expect(circuitOpenUntilFor(3, new Date("2026-07-18T00:00:00.000Z"))).toBe("2026-07-18T00:15:00.000Z");
    expect(circuitOpenUntilFor(4, new Date("2026-07-18T00:00:00.000Z"))).toBe("2026-07-18T00:30:00.000Z");
  });
});
