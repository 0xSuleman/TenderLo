import { describe, expect, it } from "vitest";
import type { RawTenderPayload } from "@tenderlo/shared";
import { buildSourceProvenance, buildTenderDocumentStoragePath } from "../../apps/worker/src/jobs";

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
});
