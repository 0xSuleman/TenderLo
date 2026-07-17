import { afterEach, describe, expect, it, vi } from "vitest";
import { PermanentSourceError } from "@tenderlo/shared";
import { getSourceAdapter, isKnownSourceDomain, normalizeSourceUrl } from "@tenderlo/sources";

describe("public source adapters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses source-profiled public tender rows and detail documents", async () => {
    const listingHtml = `
      <table id="tender_list">
        <tbody>
          <tr>
            <td>1</td>
            <td>SPPRA-100</td>
            <td>Local Government Department</td>
            <td>18/06/2026</td>
            <td>30/06/2026 11:00 AM</td>
            <td>18/06/2026</td>
            <td>Construction of drainage works in Karachi</td>
            <td><a href="/tender/100"><i class="fa fa-file"></i></a></td>
          </tr>
        </tbody>
      </table>`;
    const detailHtml = `
      <main>
        <h1>Construction of drainage works in Karachi</h1>
        <p>Single Stage Single Envelope Procedure. Sealed bids should be submitted by hand.</p>
        <a href="/docs/drainage.pdf">Download PDF</a>
      </main>`;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/tender/100") ? detailHtml : listingHtml;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("sindh-sppra").fetchTenders({
      sourceId: "source",
      sourceName: "Sindh SPPRA",
      baseUrl: "https://e.pprasindh.gov.pk/tenderlst",
      adapterKey: "sindh-sppra",
      userAgent: "test"
    });

    expect(tenders).toHaveLength(1);
    expect(tenders[0]?.title).toContain("Construction of drainage");
    expect(tenders[0]?.department).toContain("Local Government");
    expect(tenders[0]?.sourceGroup).toBe("sindh_sppra");
    expect(tenders[0]?.sourceLabel).toBe("Sindh SPPRA");
    expect(tenders[0]?.closingDate).toContain("2026-06-30");
    expect(tenders[0]?.documents[0]?.url).toBe("https://e.pprasindh.gov.pk/docs/drainage.pdf");
    expect(tenders[0]?.documents[0]?.sourceDocumentKey).toBe("drainage");
    expect(tenders[0]?.procurementMethod).toMatch(/Single Stage/i);
    expect(tenders[0]?.submissionMethod).toMatch(/Physical sealed/i);
  });

  it("adds DTA-informed PPRA source metadata and original website provenance", async () => {
    const listingHtml = `
      <table>
        <tr>
          <td>PPRA-123</td>
          <td>National Bank of Pakistan</td>
          <td><a href="/public/tenders/123">Construction of branch renovation works</a></td>
          <td>18/06/2026</td>
          <td>30/06/2026</td>
          <td><a href="https://nbp.com.pk/tenders">Official website</a></td>
        </tr>
      </table>`;
    const detailHtml = `
      <main>
        <h1>Construction of branch renovation works</h1>
        <a href="/tdoc/tender_ppra2_1718770000000.pdf">Download tender PDF</a>
      </main>`;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/public/tenders/123") ? detailHtml : listingHtml;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("federal-ppra-active").fetchTenders({
      sourceId: "source",
      sourceName: "Federal PPRA",
      baseUrl: "https://epms.ppra.gov.pk/public/tenders/active-tenders",
      adapterKey: "federal-ppra-active",
      userAgent: "test"
    });

    expect(tenders).toHaveLength(1);
    expect(tenders[0]?.sourceGroup).toBe("ppra_epads");
    expect(tenders[0]?.originalSourceUrl).toBe("https://nbp.com.pk/tenders");
    expect(tenders[0]?.websiteUrl).toBe("https://nbp.com.pk/tenders");
    expect(tenders[0]?.documents[0]?.sourceLabel).toBe("Federal PPRA Active Tenders");
    expect(tenders[0]?.documents[0]?.sourceDocumentKey).toBe("tender_ppra2_1718770000000");
  });

  it("adds KP source metadata and preserves suspicious cross-portal provenance for QA", async () => {
    const listingHtml = `
      <table>
        <tr>
          <td>KP-77</td>
          <td><a href="/tenders/77">Rehabilitation of water supply scheme in Peshawar</a></td>
          <td>Public Health Engineering Department</td>
          <td>Peshawar</td>
          <td>18/06/2026</td>
          <td>30/06/2026</td>
          <td><a href="https://epads.pprasindh.gov.pk/tenders/77">Official website</a></td>
        </tr>
      </table>`;
    const detailHtml = `
      <main>
        <h1>Rehabilitation of water supply scheme in Peshawar</h1>
        <a href="/docs/tender_kppra_1718770000000.pdf">Download PDF</a>
      </main>`;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("/tenders/77") ? detailHtml : listingHtml;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("kp-ppra-active").fetchTenders({
      sourceId: "source",
      sourceName: "KP PPRA",
      baseUrl: "https://www.kppra.gov.pk/kppra/activetenders",
      adapterKey: "kp-ppra-active",
      userAgent: "test"
    });

    expect(tenders).toHaveLength(1);
    expect(tenders[0]?.sourceGroup).toBe("kp_kppra");
    expect(tenders[0]?.originalSourceUrl).toBe("https://epads.pprasindh.gov.pk/tenders/77");
    expect(tenders[0]?.documents[0]?.sourceDocumentKey).toBe("tender_kppra_1718770000000");
    expect(isKnownSourceDomain(tenders[0]?.originalSourceUrl, ["kppra.gov.pk", "kp.eprocure.gov.pk"])).toBe(false);
  });

  it("normalizes source URLs without losing the original public target", () => {
    expect(normalizeSourceUrl("https://www.ppra.org.pk/tender/?utm_source=x&gclid=y#section")).toBe("https://ppra.org.pk/tender");
  });

  it("fails gated sources instead of scraping through access controls", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>captcha access denied</html>", { status: 200 }));

    await expect(getSourceAdapter("developmentaid-pakistan-public").fetchTenders({
      sourceId: "source",
      sourceName: "DevelopmentAid",
      baseUrl: "https://www.developmentaid.org/tenders/search?locations=167&showAdvancedFilters=1",
      adapterKey: "developmentaid-pakistan-public",
      userAgent: "test"
    })).rejects.toBeInstanceOf(PermanentSourceError);
  });
});
