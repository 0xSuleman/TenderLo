import { describe, expect, it } from "vitest";
import {
  buildCanonicalTenderId,
  calculateDuplicateConfidence,
  classifyTender,
  detectGeography,
  extractTenderFields,
  normalizeDepartment,
  parseDateCandidates,
  parseMoneyCandidates
} from "@tenderlo/intelligence";

describe("deterministic tender intelligence", () => {
  it("parses Pakistani tender dates", () => {
    const dates = parseDateCandidates("Last date for bid submission is 25-05-2026 at 11:00 AM.");
    expect(dates[0]?.value).toContain("2026-05-25");
  });

  it("parses rupee money formats", () => {
    const money = parseMoneyCandidates("Bid security Rs. 2.5 million and document fee PKR 5,000.");
    expect(money.map((item) => item.value)).toContain(2_500_000);
    expect(money.map((item) => item.value)).toContain(5_000);
  });

  it("extracts bid security, closing date, and PEC evidence", () => {
    const fields = extractTenderFields("PEC C-4 required. Bid security Rs. 1,000,000. Closing date 30/06/2026.");
    expect(fields.some((field) => field.fieldName === "pec_category" && field.fieldValue === "C-4")).toBe(true);
    expect(fields.some((field) => field.fieldName === "bid_security_amount")).toBe(true);
    expect(fields.some((field) => field.evidenceText.length > 0)).toBe(true);
  });

  it("detects geography and normalizes departments", () => {
    expect(detectGeography("Tender for water supply works in Lahore Punjab").city).toBe("Lahore");
    expect(normalizeDepartment("NHA procurement wing")).toBe("National Highway Authority");
  });

  it("classifies contractor sectors with title weighting", () => {
    const matches = classifyTender({ title: "Road rehabilitation and bridge works in Punjab", body: "civil works" });
    expect(matches[0]?.sector).toBe("roads");
    expect(matches[0]?.isPrimary).toBe(true);
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
