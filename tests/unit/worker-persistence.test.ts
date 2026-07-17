import { describe, expect, it } from "vitest";
import type { RawTenderPayload } from "@tenderlo/shared";
import { buildSourceProvenance, buildTenderDocumentStoragePath, buildTenderFieldPromotion, validateDownloadedDocument } from "../../apps/worker/src/jobs";

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
    })).toMatch(/does not have a PDF signature/i);
  });
});
