import { describe, expect, it } from "vitest";
import {
  buildCanonicalTenderId,
  calculateDuplicateConfidence,
  classifyTender,
  detectGeography,
  extractFederalEpadsDocumentFields,
  extractKpPpraNoticeFields,
  extractPunjabPpraCorrectionFields,
  extractTenderFields,
  normalizeDepartment,
  parseDateCandidates,
  parseMoneyCandidates
} from "@tenderlo/intelligence";

describe("deterministic tender intelligence", () => {
  it("parses Pakistani tender dates", () => {
    const dates = parseDateCandidates("Last date for bid submission is 25-05-2026 at 11:00 AM.");
    expect(dates[0]?.value).toContain("2026-05-25");
    expect(parseDateCandidates("Submit on or before Monday, July 20, 2026 10:00 AM.")[0]?.value).toBe("2026-07-20T10:00:00.000Z");
  });

  it("parses rupee money formats", () => {
    const money = parseMoneyCandidates("Bid security Rs. 2.5 million, lot security 1200000 PKR, and document fee PKR 5,000.");
    expect(money.map((item) => item.value)).toContain(2_500_000);
    expect(money.map((item) => item.value)).toContain(1_200_000);
    expect(money.map((item) => item.value)).toContain(5_000);
  });

  it("extracts bid security, closing date, and PEC evidence", () => {
    const fields = extractTenderFields("PEC C-4 required. Bid security Rs. 1,000,000. Closing date 30/06/2026.");
    expect(fields.some((field) => field.fieldName === "pec_category" && field.fieldValue === "C-4")).toBe(true);
    expect(fields.some((field) => field.fieldName === "bid_security_amount")).toBe(true);
    expect(fields.some((field) => field.evidenceText.length > 0)).toBe(true);

    const epadsDates = extractTenderFields("The RFP must be submitted on Monday, July 20, 2026 10:00 AM. Proposals will be opened on Monday, July 20, 2026 10:30 AM.");
    expect(epadsDates.find((field) => field.fieldName === "closing_date")?.fieldValue).toBe("2026-07-20T10:00:00.000Z");
    expect(epadsDates.find((field) => field.fieldName === "opening_date")?.fieldValue).toBe("2026-07-20T10:30:00.000Z");
  });

  it("extracts EPADS lot securities and contact evidence from generated bidding documents", () => {
    const text = "Ministry of Education. (Ministry of Education),Section Officer 2nd Floor, C-Block, Pak-Sec Islamabad. " +
      "Phone: +92-321-511-1688, Email: talat@moe.gov.pk Items/Lots Item UNSPSC Delivery Schedule Quantity Bid Security " +
      "Lot No. 1 Office stationery Quantity: 1/Lot 1 1/Lot 1200000 PKR ------ " +
      "Lot No. 2 Computer stationery Quantity: 1/Lot 2 1/Lot 2200000 PKR ------ Related Services of Goods: No";
    const common = extractTenderFields(text);
    const epads = extractFederalEpadsDocumentFields(text);
    expect(common.find((field) => field.fieldName === "contact_email")?.fieldValue).toBe("talat@moe.gov.pk");
    expect(common.find((field) => field.fieldName === "contact_phone")?.fieldValue).toBe("+92-321-511-1688");
    expect(epads.find((field) => field.fieldName === "contact_person")?.fieldValue).toBe("Section Officer");
    expect(epads.filter((field) => field.fieldName === "bid_security_amount").map((field) => field.fieldValue)).toEqual(["1200000", "2200000"]);
    expect(epads.find((field) => field.fieldName === "bid_security_summary")?.fieldValue).toContain("varies by lot");
    expect(epads.find((field) => field.fieldName === "estimated_value_lower_bound")?.fieldValue).toBe("68000000");
    expect(epads.find((field) => field.fieldName === "estimated_value_summary")?.fieldValue).toContain("exact estimate not published");
  });

  it("prefers Punjab PPRA corrigendum replacement values", () => {
    const fields = extractPunjabPpraCorrectionFields(
      "Estimated Cost Rs.49.00 Million shall be read as Estimated Cost Rs.55.50 Million. " +
      "Bid Security amount may be read as Rs.1,110,000 instead of Rs.980,000. " +
      "The date for submission of bids has been extended from 07 th July, 2026 to 14 th July, 2026 (Tuesday) at 11:00AM (PST) and shall be opened on same date at 11:30AM (PST)."
    );
    expect(fields.find((field) => field.fieldName === "estimated_value")?.fieldValue).toBe("55500000");
    expect(fields.find((field) => field.fieldName === "bid_security_amount")?.fieldValue).toBe("1110000");
    expect(fields.find((field) => field.fieldName === "closing_date")?.fieldValue).toBe("2026-07-14T11:00:00.000Z");
    expect(fields.find((field) => field.fieldName === "opening_date")?.fieldValue).toBe("2026-07-14T11:30:00.000Z");
  });

  it("extracts KP PPRA closing time and same-day opening time from a scanned-notice transcript", () => {
    const fields = extractKpPpraNoticeFields(
      "Interested bidders must upload their bids on or before 5th August 2026 till 10:30 a.m. " +
      "The bids will be opened on the same day at 11:00 a.m. in the presence of bidders."
    );
    expect(fields.find((field) => field.fieldName === "closing_date")?.fieldValue).toBe("2026-08-05T10:30:00.000Z");
    expect(fields.find((field) => field.fieldName === "opening_date")?.fieldValue).toBe("2026-08-05T11:00:00.000Z");
  });

  it("detects geography and normalizes departments", () => {
    expect(detectGeography("Tender for water supply works in Lahore Punjab").city).toBe("Lahore");
    expect(detectGeography("PESCO HQ, Peshawar. Standard terms refer to Islamabad.").city).toBe("Peshawar");
    expect(normalizeDepartment("NHA procurement wing")).toBe("National Highway Authority");
  });

  it("classifies contractor sectors with title weighting", () => {
    const matches = classifyTender({ title: "Road rehabilitation and bridge works in Punjab", body: "civil works" });
    expect(matches[0]?.sector).toBe("roads");
    expect(matches[0]?.isPrimary).toBe(true);
    expect(classifyTender({ title: "Laying of tuff tiles in village streets" })[0]?.sector).toBe("roads");
    expect(classifyTender({ title: "Protection bund at Allahbad Mach" })[0]?.sector).toBe("water");
    expect(classifyTender({ title: "Rehabilitation and lining of flood nallah" })[0]?.sector).toBe("water");
  });

  it("scores high-confidence duplicates", () => {
    const canonical = buildCanonicalTenderId({
      sourceId: "source",
      sourceUrl: "https://example.test/tender/1",
      tenderNumber: "NHA-1",
      title: "Road rehabilitation works",
      department: "NHA",
      closingDate: "2026-06-30"
    });
    expect(canonical).toContain("road");
    const duplicate = calculateDuplicateConfidence(
      {
        source_url: "https://example.test/tender/1",
        tender_number: "NHA-1",
        normalized_title: "road rehabilitation works",
        department: "National Highway Authority",
        closing_date: "2026-06-30",
        bid_security_amount: 1000
      },
      {
        id: "candidate",
        source_url: "https://example.test/tender/1",
        tender_number: "NHA-1",
        normalized_title: "road rehabilitation works",
        department: "National Highway Authority",
        closing_date: "2026-06-30",
        bid_security_amount: 1000
      }
    );
    expect(duplicate.action).toBe("merge");
  });
});
