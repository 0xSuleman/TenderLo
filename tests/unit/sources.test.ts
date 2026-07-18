import { afterEach, describe, expect, it, vi } from "vitest";
import { PermanentSourceError } from "@tenderlo/shared";
import { fetchBinary, getSourceAdapter, normalizeSourceUrl, parseBppraDeadline, parseFederalEpadsDeadline, parseFederalEpadsListing, parseFederalPpraDate, parseSindhPpraDateTime, parseSsgcActiveTendersListing } from "@tenderlo/sources";

describe("public source adapters", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses SSGC active rows with deadline, fee, and consent-page URL", () => {
    const tenders = parseSsgcActiveTendersListing(`
      <table><tbody>
        <tr><td class="record_row_blue_1_c">1</td><td><a href="?page_id=112442&do=35607">SSGC/FP/PT/14384</a></td><td>Aug 13, 2026</td><td>10:00 AM</td><td>Rs. 3000/-</td></tr>
        <tr><td class="record_row_blue_2_l" colspan="5">Pre-Coated Line Pipe</td></tr>
        <tr><td>Open Competitive Bidding</td><td><a href="https://www.ssgc.com.pk/web/?page_id=115520&do=35607">Download Tender Document</a></td></tr>
      </tbody></table>`, "https://www.ssgc.com.pk/web/?page_id=111492");

    expect(tenders).toHaveLength(1);
    expect(tenders[0]).toMatchObject({
      tenderNumber: "SSGC/FP/PT/14384",
      title: "Pre-Coated Line Pipe",
      department: "Sui Southern Gas Company Limited",
      documentFee: 3000,
      closingDate: "2026-08-13T05:00:00.000Z",
      documents: []
    });
    expect((tenders[0]?.sourceMetadata as { ssgcDocumentPageUrl?: string }).ssgcDocumentPageUrl).toContain("do=35607");
  });

  it("ingests current Sindh SPPRA API pages and resolves bidding and PA publication downloads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const firstTender = sindhPpraTender(673183, "EPADS-S-26070803203", "2026-08-13T13:00:00");
    const expiredTender = sindhPpraTender(600000, "EPADS-S-OLD", "2024-05-14T09:30:00");
    const secondTender = sindhPpraTender(673184, "EPADS-S-26070803204", "2026-08-08T10:30:00");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      if (requestUrl.includes("/getallpublictenders")) {
        const records = requestBody.pagination?.pageNumber === "2" ? [secondTender] : [firstTender, expiredTender];
        return Response.json({ success: true, data: { totalRecords: 3, totalPages: 2, records } });
      }
      if (requestUrl.includes("/getallpublisheddocumentdetailbypdidpublication")) {
        const data = requestBody.Id === 673183
          ? [{
            dmS_FileID: 8426498,
            dmS_FileGUID: "corrigendum-guid",
            tr_PublishedDocumentID: 1040431,
            tR_DocumentTemplateID: 673183,
            documentTemplateName: "(Corrigendum) V(2)",
            procurementPlansDetailID: 803203,
            publishedDocumentID: 673183,
            publishDate: "2026-07-17T21:59:19.16",
            isCorrigendum: 1
          }]
          : [];
        return Response.json({ success: true, data });
      }
      if (requestUrl.includes("/getallpublisheddocumentdetailbypdid")) {
        const fileId = requestBody.Id === 673183 ? 8425687 : 8425688;
        return Response.json({
          success: true,
          data: [{
            dmS_FileID: fileId,
            dmS_FileGUID: `bidding-guid-${requestBody.Id}`,
            tr_PublishedDocumentID: requestBody.Id,
            tR_DocumentTemplateID: requestBody.Id + 60941,
            documentTemplateName: "Standard Bidding Document",
            procurementPlansDetailID: requestBody.Id + 130020,
            publishDate: "2026-07-17T18:09:08.293",
            isCorrigendum: 0,
            fileContent: "large-runtime-payload-must-not-enter-raw-snapshot"
          }]
        });
      }
      if (requestUrl.includes("/downloadportalfilebyguid")) {
        return Response.json({
          success: true,
          data: {
            bytes: Buffer.from("%PDF-1.7 Sindh bidding document").toString("base64"),
            contentType: "application/pdf",
            fileName: "NIT for Abkalani Material T.M Khani Drainage Division.pdf"
          }
        });
      }
      return new Response("not found", { status: 404 });
    });

    const tenderPromise = getSourceAdapter("sindh-sppra").fetchTenders({
      sourceId: "source",
      sourceName: "Sindh SPPRA",
      baseUrl: "https://portalsindh.eprocure.gov.pk/#/",
      adapterKey: "sindh-sppra",
      userAgent: "test"
    });
    await vi.runAllTimersAsync();
    const tenders = await tenderPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(tenders).toHaveLength(2);
    expect(tenders[0]).toMatchObject({
      sourceUrl: "https://portalsindh.eprocure.gov.pk/?tenderNo=EPADS-S-26070803203",
      tenderNumber: "EPADS-S-26070803203",
      title: expect.stringContaining("Abkalani Materials"),
      department: "XEN Drainage Division Tando Muhammad Khan",
      province: "Sindh",
      city: "Tando muhammad khan",
      advertisementDate: "2026-07-17",
      closingDate: "2026-08-13T08:00:00.000Z",
      openingDate: "2026-08-13T08:30:00.000Z",
      estimatedValue: 61000000,
      submissionMethod: "Electronic via Sindh EPADS",
      sourceStatus: "In-Progress",
      sourceGroup: "sindh_sppra"
    });
    expect(tenders[0]?.documents).toMatchObject([
      {
        filename: "EPADS-S-26070803203-Standard-Bidding-Document.pdf",
        mimeType: "application/pdf",
        sourceDocumentKey: "sindh_sppra_bidding_8425687",
        downloadRequest: {
          method: "POST",
          body: { ID: 8425687, idsList: "bidding-guid-673183" },
          responseFormat: "json_base64"
        }
      },
      {
        filename: "EPADS-S-26070803203-Corrigendum-V-2.pdf",
        sourceDocumentKey: "sindh_sppra_corrigendum_8426498"
      }
    ]);
    expect(tenders[0]?.sourceMetadata).toMatchObject({
      publishedDocumentId: 673183,
      procurementPlansDetailId: 803203,
      bidValidityDate: "2026-11-11",
      primaryDocumentLookup: "fetched",
      publicationLookup: "fetched",
      biddingDocumentCount: 1,
      paPublicationCount: 1
    });
    expect(tenders[0]?.rawSnapshot).toMatchObject({ contentType: "application/json; charset=utf-8", extension: "json" });
    expect(tenders[0]?.rawSnapshot?.content).toContain('"dmS_FileID":8425687');
    expect(tenders[0]?.rawSnapshot?.content).not.toContain("large-runtime-payload-must-not-enter-raw-snapshot");

    const downloaded = await fetchBinary(
      tenders[0]!.documents[0]!.url,
      "test",
      tenders[0]!.documents[0]!.downloadRequest
    );
    expect(downloaded).toMatchObject({
      ok: true,
      contentType: "application/pdf",
      filename: "NIT for Abkalani Material T.M Khani Drainage Division.pdf"
    });
    expect(downloaded.buffer.toString()).toBe("%PDF-1.7 Sindh bidding document");
  });

  it("ingests KP eProcure public rows and its modal-backed SBD/SPD download", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const tender = {
      ...sindhPpraTender(80646, "EPADS-K-250560595", "2026-08-03T12:00:00"),
      tenderNumber: "K-250560595",
      departmentName: "TMA Babuzai",
      location: "Babuzai",
      estimatedCost: "12500000"
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (requestUrl.includes("/getallpublictenders")) {
        return Response.json({ success: true, data: { totalRecords: 1, totalPages: 1, records: [tender] } });
      }
      if (requestUrl.includes("getallpublisheddocumentdetailbypdidpublication")) {
        return Response.json({ success: true, data: [] });
      }
      if (requestUrl.includes("getallpublisheddocumentdetailbypdid")) {
        return Response.json({ success: true, data: [{
          dmS_FileID: 91001,
          dmS_FileGUID: "kp-sbd-guid",
          documentTemplateName: "SBD SPD",
          publishedDocumentID: body.Id
        }] });
      }
      return new Response("not found", { status: 404 });
    });

    const pending = getSourceAdapter("kp-eprocure").fetchTenders({
      sourceId: "source",
      sourceName: "KP eProcure",
      baseUrl: "https://portalkp.eprocure.gov.pk/#/tenders/Epadtenders",
      adapterKey: "kp-eprocure",
      userAgent: "test"
    });
    await vi.runAllTimersAsync();
    const tenders = await pending;

    expect(tenders).toHaveLength(1);
    expect(tenders[0]).toMatchObject({
      tenderNumber: "EPADS-K-250560595",
      province: "Khyber Pakhtunkhwa",
      department: "TMA Babuzai",
      estimatedValue: 12500000,
      submissionMethod: "Electronic via KP EPADS"
    });
    expect(tenders[0]?.documents[0]).toMatchObject({
      filename: "EPADS-K-250560595-SBD-SPD.pdf",
      sourceDocumentKey: "kp_eprocure_bidding_91001",
      downloadRequest: { body: { loggedInUserOfficeID: 31603, ID: 91001, idsList: "kp-sbd-guid" } }
    });
    const listingCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/getallpublictenders"));
    expect(listingCall?.[1]?.headers).toMatchObject({ officedetail: "KPK-PPRA-Dev" });
  });

  it("ingests every paginated Federal EPADS row with full tooltip values and official PDFs", async () => {
    const firstPageRows = Array.from({ length: 100 }, (_, index) => federalEpadsRow(53111 + index, index + 1)).join("");
    const listingPageOne = federalEpadsListing(firstPageRows, '<a href="/?page=2">2</a>');
    const listingPageTwo = federalEpadsListing(federalEpadsRow(54001, 101));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = new URL(String(url)).searchParams.get("page") === "2" ? listingPageTwo : listingPageOne;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("federal-epads").fetchTenders({
      sourceId: "source",
      sourceName: "Federal EPADS",
      baseUrl: "https://epads.gov.pk/?page=1",
      adapterKey: "federal-epads",
      userAgent: "test"
    });

    expect(tenders).toHaveLength(101);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(tenders[0]).toMatchObject({
      sourceUrl: "https://epads.gov.pk/opportunities/federal/procurements/53111",
      title: "Full procurement title 53111",
      tenderNumber: "P53111",
      department: "Material Management (PESCO)",
      procurementCategory: "Consultancy Services",
      procurementMethod: "Single Stage-Two Envelope",
      advertisementDate: "2026-07-04T14:40:00.000Z",
      closingDate: "2026-07-20T05:00:00.000Z",
      submissionMethod: "Electronic via EPADS"
    });
    expect(tenders[0]?.documents[0]).toMatchObject({
      url: "https://pa.epads.gov.pk/procurement/SBD/p53111/bidding-document.pdf?download=true",
      filename: "P53111-bidding-document.pdf",
      mimeType: "application/pdf",
      sourceDocumentKey: "epads_P53111_sbd"
    });
    const pettyPurchase = parseFederalEpadsListing(federalEpadsListing(federalEpadsRow(53112, 2).replace("Single Stage-Two Envelope", "Petty Purchase")), "https://epads.gov.pk/?page=1");
    expect(pettyPurchase[0]?.documents).toEqual([]);
  });

  it("posts through every Punjab PPRA grid page and keeps both official PDFs", async () => {
    const pageOne = punjabPpraListing(
      Array.from({ length: 50 }, (_, index) => punjabPpraRow(252878 + index)).join(""),
      0,
      2,
      `<a href="javascript:__doPostBack('grid$page2','')">2</a>`
    );
    const pageTwo = punjabPpraListing(punjabPpraRow(253001), 1, 2);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = init?.method === "POST" ? pageTwo : pageOne;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("punjab-ppra").fetchTenders({
      sourceId: "source",
      sourceName: "Punjab PPRA",
      baseUrl: "https://eproc.punjab.gov.pk/Admin_Tender_Search.aspx",
      adapterKey: "punjab-ppra",
      userAgent: "test"
    });

    expect(tenders).toHaveLength(51);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(new URLSearchParams(String(fetchSpy.mock.calls[1]?.[1]?.body)).get("__EVENTTARGET")).toBe("grid$page2");
    expect(tenders[0]).toMatchObject({
      title: "Punjab procurement 252878",
      department: "District Council, Lahore",
      procurementCategory: "Works",
      province: "Punjab",
      advertisementDate: "2026-07-13",
      closingDate: "2026-07-14T18:59:59.999Z",
      sourceStatus: "Violated Tender"
    });
    expect(tenders[0]?.documents).toMatchObject([
      { url: "https://eproc.punjab.gov.pk/Tenders/50485054/4855/notice252878.pdf", mimeType: "application/pdf" },
      { url: "https://eproc.punjab.gov.pk/BiddingDocuments/50485054/4855/bid252878.pdf", mimeType: "application/pdf" }
    ]);
  });

  it("ingests every Federal PPRA page and enriches tenders from stable detail and PDF links", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0 as any;
    });
    const firstPage = federalPpraListing(
      Array.from({ length: 50 }, (_, index) => federalPpraRow(7670 + index, index + 1)).join(""),
      1,
      2,
      51
    );
    const secondPage = federalPpraListing(federalPpraRow(8000, 51), 2, 2, 51);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname.includes("/tender-details/")) {
        const tenderNumber = parsedUrl.pathname.split("/").at(-1) ?? "TS0000007670E";
        return new Response(federalPpraDetail(tenderNumber), { status: 200, headers: { "content-type": "text/html" } });
      }
      const body = parsedUrl.searchParams.get("page") === "2" ? secondPage : firstPage;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("federal-ppra-active").fetchTenders({
      sourceId: "source",
      sourceName: "Federal PPRA",
      baseUrl: "https://epms.ppra.gov.pk/public/tenders/active-tenders",
      adapterKey: "federal-ppra-active",
      userAgent: "test"
    });

    expect(fetchSpy).toHaveBeenCalledTimes(53);
    expect(tenders).toHaveLength(51);
    expect(tenders[0]).toMatchObject({
      sourceUrl: "https://epms.ppra.gov.pk/public/tenders/tender-details/TS0000007670E",
      tenderNumber: "TS0000007670E",
      title: "GANTRY MILLING MACHINE",
      department: "Pakistan Railways",
      city: "Lahore",
      procurementCategory: "Works",
      procurementMethod: "Single Stage-Two Envelope",
      submissionMethod: "Electronic via EPADS or stated online portal",
      advertisementDate: "2026-07-17",
      closingDate: "2026-08-27T06:00:00.000Z",
      openingDate: "2026-08-27T06:30:00.000Z",
      bidSecurityAmount: 3000000,
      sourceGroup: "ppra_epads"
    });
    expect(tenders[0]?.contactPerson).toContain("dropbox@pakrail.gov.pk");
    expect(tenders[0]?.documents).toMatchObject([
      {
        url: expect.stringContaining("https://epms.ppra.gov.pk/pdf?file="),
        filename: "1780996714_6a27da6a856c9.pdf",
        mimeType: "application/pdf",
        sourceDocumentKey: "epms_tender_1780996714_6a27da6a856c9"
      },
      {
        url: expect.stringContaining("https://epms.ppra.gov.pk/pdf?file="),
        filename: "283661_dir_procurement17july26.pdf",
        mimeType: "application/pdf",
        sourceDocumentKey: "epms_advertisement_283661_dir_procurement17july26"
      }
    ]);
    expect(tenders[0]?.sourceMetadata).toMatchObject({
      detailFetchStatus: "fetched",
      invoiceUrl: "https://epms.ppra.gov.pk/public/tenders/invoice/TS0000007670E",
      agencyReference: "DP/CGMMA//2026",
      tenderType: "Tender Notice",
      tenderNature: "Local",
      sector: "Civil Works",
      bidValidity: "150 days",
      corrigenda: [expect.stringContaining("Updated Closing Date: July 21, 2026")]
    });
  });

  it("ingests every KP PPRA page, JSON popup field, and PDF or image document", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0 as any;
    });
    const firstPage = kpPpraListing(
      Array.from({ length: 25 }, (_, index) => kpPpraRow(32478 + index)).join(""),
      1,
      25,
      255
    );
    const secondPage = kpPpraListing(kpPpraRow(32503), 26, 26, 255);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname.includes("class.tender.php")) {
        const tenderNumber = Number(parsedUrl.searchParams.get("tender_id")) - 3000;
        return new Response(kpPpraDetail(tenderNumber), { status: 200, headers: { "content-type": "text/html" } });
      }
      const body = parsedUrl.searchParams.get("p") === "2" ? secondPage : firstPage;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const tenders = await getSourceAdapter("kp-ppra-active").fetchTenders({
      sourceId: "source",
      sourceName: "KP PPRA",
      baseUrl: "https://www.kppra.gov.pk/kppra/activetenders",
      adapterKey: "kp-ppra-active",
      userAgent: "test"
    });

    expect(tenders).toHaveLength(26);
    expect(fetchSpy).toHaveBeenCalledTimes(37);
    expect(tenders[0]?.sourceGroup).toBe("kp_kppra");
    expect(tenders[0]).toMatchObject({
      sourceUrl: "http://kppra.gov.pk/kppra/activetenders.php?tender_ref=32478",
      tenderNumber: "32478",
      title: "KP procurement 32478",
      department: "C&W Division Kohistan Upper",
      procurementCategory: "Goods",
      advertisementDate: "2026-07-17",
      closingDate: "2026-08-05T18:59:59.999Z",
      province: "Khyber Pakhtunkhwa"
    });
    expect(tenders[0]?.procurementMethod).toBeUndefined();
    expect(tenders[0]?.documents[0]).toMatchObject({
      url: "http://kppra.gov.pk/kppra/staff/force_download.php?file=dept/upload/1784266143nit.jpg",
      filename: "1784266143nit.jpg",
      mimeType: "image/jpeg",
      sourceDocumentKey: "kp_notice_1784266143nit"
    });
    const tenderWithBiddingDocument = tenders.find((tender) => tender.tenderNumber === "32484");
    expect(tenderWithBiddingDocument?.documents.map((document) => document.filename)).toEqual([
      "1784268775cnwkohistanupper.pdf",
      "1784268775cnwkohistanupperbidding.pdf"
    ]);
    expect(tenderWithBiddingDocument?.sourceMetadata).toMatchObject({
      internalTenderId: "35484",
      detailFetchStatus: "fetched",
      tenderDomain: "Local"
    });
  });

  it("ingests Balochistan PPRA API pages with exact PKT times and printable reports", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0 as any;
    });
    const activeTender = bppraTender(98216, "TSE-2627071128513", "Cancel");
    const expiredTender = {
      ...bppraTender(97000, "TSE-OLD", "Open"),
      CloseDate: "1/1/2020 12:00:00 AM"
    };
    const secondTender = {
      ...bppraTender(98217, "TSE-2627071128514", "Open"),
      PType: "anrpc",
      PlanningId: 95000
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/DnnPlan/get")) {
        return Response.json({
          Succeeded: true,
          Data: { Objects: [{ ObjectClass: "Road Works", Method: "Single Stage One Envelope Bidding Procedure" }] }
        });
      }
      const tenders = requestUrl.includes("/2/100/") ? [secondTender] : [activeTender, expiredTender];
      return Response.json({ status: true, TotalPages: 101, tenders });
    });

    const tenders = await getSourceAdapter("balochistan-bppra").fetchTenders({
      sourceId: "source",
      sourceName: "Balochistan PPRA",
      baseUrl: "https://bpptwo.vdc.services:5451/Tenders",
      adapterKey: "balochistan-bppra",
      userAgent: "test"
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(tenders).toHaveLength(2);
    expect(tenders[0]).toMatchObject({
      sourceUrl: "https://bpptwo.vdc.services:5451/Tenders?search=TSE-2627071128513",
      tenderNumber: "TSE-2627071128513",
      title: "Construction of B/T road",
      department: "Executive Engineer Provincial B&R",
      procurementCategory: "Works",
      province: "Balochistan",
      city: "Sohbatpur",
      advertisementDate: "2026-07-17",
      closingDate: "2026-08-03T07:00:00.000Z",
      openingDate: "2026-08-03T08:00:00.000Z",
      estimatedValue: 11941412,
      documentFee: 3000,
      procurementMethod: "Single Stage One Envelope Bidding Procedure",
      submissionMethod: "Manual bidding",
      sourceStatus: "Cancel"
    });
    expect(tenders[0]?.documents).toMatchObject([
      {
        url: "https://bpptwo.vdc.services:9446/Images/BOQManual/works-report.pdf",
        mimeType: "application/pdf",
        sourceDocumentKey: "bppra_notice_98216"
      }
    ]);
    expect(tenders[0]?.rawSnapshot).toMatchObject({ contentType: "application/json; charset=utf-8", extension: "json" });
    expect(tenders[1]?.documents).toMatchObject([
      {
        url: "https://bpptwo.vdc.services:9446/Images/BOQManual/works-report.pdf",
        mimeType: "application/pdf",
        sourceDocumentKey: "bppra_notice_98217"
      }
    ]);
  });

  it("normalizes source URLs without losing the original public target", () => {
    expect(normalizeSourceUrl("https://www.ppra.org.pk/tender/?utm_source=x&gclid=y#section")).toBe("https://ppra.org.pk/tender");
    expect(parseFederalEpadsDeadline("1h 30m Left", new Date("2026-07-17T14:00:00.000Z"))).toBe("2026-07-17T15:30:00.000Z");
    expect(parseFederalPpraDate("August 27, 2026 at 11:00 AM", true)).toBe("2026-08-27T06:00:00.000Z");
    expect(parseBppraDeadline("7/24/2026 12:00:00 AM", "1784264400000", true)).toBe("2026-07-24T05:00:00.000Z");
    expect(parseBppraDeadline("7/24/2026 12:00:00 AM", "12:00 PM", true)).toBe("2026-07-24T07:00:00.000Z");
    expect(parseSindhPpraDateTime("2026-08-13T13:30:00")).toBe("2026-08-13T08:30:00.000Z");
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

function sindhPpraTender(publishedDocumentID: number, tenderNumbers: string, lastSubmissionDate: string) {
  return {
    publishedDocumentID,
    tR_DocumentTemplateID: publishedDocumentID + 60941,
    procurementPlansDetailID: publishedDocumentID === 673183 ? 803203 : publishedDocumentID + 130020,
    name: "Procurement of Goods Annual Abkalani Materials, De-weeding, and Repair of Hydraulic Gates and Structures",
    description: "",
    tenderNumber: tenderNumbers.replace(/^EPADS-/, ""),
    tenderNumbers,
    isPublished: true,
    isInternationalPublish: false,
    officeID: 417793,
    publishDate: "2026-07-17T18:09:08.293",
    lastSubmissionDate,
    bidOpeningDate: lastSubmissionDate.replace("13:00:00", "13:30:00").replace("10:30:00", "11:00:00"),
    bidValidityDate: "2026-11-11T00:00:00",
    clarificationDate: "2026-08-07T19:00:00",
    departmentName: "XEN Drainage Division Tando Muhammad Khan",
    statusName: "In-Progress",
    location: "Tando muhammad khan",
    voilation: null,
    procurementCategory: null,
    bidSubmissionType: 0,
    estimatedCost: "61000000",
    procurementMethod: null,
    procurementProcedure: null
  };
}

function federalEpadsListing(rows: string, pagination = ""): string {
  return `<main><table class="table table-sm table-cb"><tbody>${rows}</tbody></table>${pagination}</main>`;
}

function federalEpadsRow(id: number, position: number): string {
  return `<tr>
    <td>${position}</td>
    <td><span>P${id}</span></td>
    <td>
      <a href="/opportunities/federal/procurements/${id}">
        <span title="Full procurement title ${id}">Full procurement...</span>
      </a>
      <span title="Material Management (PESCO)">Material Management...</span>
    </td>
    <td>
      <div><span class="text-uppercase">Published On:</span><span class="badge bg-label-success">Saturday, July 4, 2026 07:40 PM</span></div>
      <div><span class="text-uppercase">Closing On:</span><span class="badge bg-label-primary">Monday, July 20, 2026 10:00 AM</span></div>
    </td>
    <td><span class="badge">Consultancy Services</span><span class="text-secondary">Single Stage-Two Envelope</span></td>
    <td><a href="/opportunities/federal/procurements/${id}">View</a></td>
  </tr>`;
}

function federalPpraListing(rows: string, page: number, pageCount: number, total: number): string {
  return `<main>
    <p>Showing ${rows.match(/<tr>/g)?.length ?? 0} of ${total} tenders</p>
    <p>Page ${page} of ${pageCount}</p>
    <table><tbody>${rows}</tbody></table>
  </main>`;
}

function federalPpraRow(id: number, position: number): string {
  const tenderNumber = `TS${String(id).padStart(10, "0")}E`;
  return `<tr>
    <td>${position}</td>
    <td class="tender-no"><strong>${tenderNumber}</strong></td>
    <td><div>
      <strong>GANTRY MILLING MACHINE</strong>
      <small class="text-muted d-block">Corrigendum</small>
      <small class="text-muted d-block">Supply, Installation and Commissioning of CNC Gantry Milling Machine through EPADS.</small>
      <small class="badge bg-light text-dark">Civil Works</small>
      <small class="badge bg-light text-dark">DP/CGMMA//2026</small>
      <small class="badge bg-light text-dark"><i class="ri-organization-chart"></i> Pakistan Railways</small>
    </div></td>
    <td>
      <small class="text-muted text-dark d-block"><i class="ri-organization-chart"></i> Pakistan Railways</small>
      <span class="tender-org">Pakistan Railways</span>
      <small class="text-muted d-block"><i class="ri-map-pin-line"></i> Lahore - Pakistan</small>
    </td>
    <td><span class="tender-badge">Published</span><span class="tender-badge">Corrigendum</span></td>
    <td>Jul 17, 2026</td>
    <td><strong>Aug 27, 2026</strong><small>11:00 AM</small></td>
    <td>
      <a href="/public/tenders/tender-details/${tenderNumber}">View</a>
      <a href="/public/tenders/invoice/${tenderNumber}">Invoice</a>
    </td>
  </tr>`;
}

function federalPpraDetail(tenderNumber: string): string {
  const tenderFile = Buffer.from("tender_attachments/1780996714_6a27da6a856c9.pdf").toString("base64");
  const advertisementFile = Buffer.from("advertisement_docs/283661_dir_procurement17july26.pdf").toString("base64");
  const item = (label: string, value: string) => `<div class="list-group-item"><span class="detail-label">${label}</span><span class="flex-grow-1">${value}</span></div>`;
  return `<main>
    <div class="hero"><h1>GANTRY MILLING MACHINE</h1><p>Tender No: <strong>${tenderNumber}</strong></p><span class="badge-corrigendum">Corrigendum Issued</span></div>
    <a href="/pdf?file=${encodeURIComponent(tenderFile)}">Download Tender Document</a>
    <a href="/pdf?file=${encodeURIComponent(advertisementFile)}">Download Advertisement</a>
    <div class="list-group">
      ${item("Organization Name:", "Pakistan Railways")}
      ${item("Office Name:", "Pakistan Railways")}
      ${item("Office Address:", "Information Technology Department Pakistan Railways Headquarters Office, Empress Road, Lahore")}
      ${item("City:", "Lahore")}
      ${item("Contact Person:", "Uzma Farrukh")}
      ${item("Contact Email:", "dropbox@pakrail.gov.pk")}
      ${item("Contact Phone:", "+92-429-920-1639")}
      ${item("Tender Type", "Tender Notice")}
      ${item("Tender No / Reference No / Tender Inquiry No", "DP/CGMMA//2026")}
      ${item("Procurement Category", "Works")}
      ${item("Procurement Procedure", "Single Stage-Two Envelope")}
      ${item("Sector", "Civil Works")}
      ${item("Tender Nature", "Local")}
      ${item("Advertisement Date", "July 17, 2026")}
      ${item("Closing Date & Time", "August 27, 2026 at 11:00 AM")}
      ${item("Opening Time", "11:30 AM")}
      ${item("Bid Security", "3,000,000.00")}
      ${item("Bid Validity", "150 days")}
    </div>
    <div><h6>Description</h6><div class="bg-light">Supply, Installation and Commissioning of CNC Gantry Milling Machine through EPADS.</div></div>
    <div><h6>Note</h6><div class="bg-light">Corrigendum</div></div>
    <div class="corrigendum-item">Corrigendum #1 Issued On: July 17, 2026 11:02 AM Updated Closing Date: July 21, 2026</div>
  </main>`;
}

function punjabPpraListing(rows: string, currentPageIndex: number, pageCount: number, pager = ""): string {
  return `<form id="aspnetForm">
    <input type="hidden" name="__EVENTTARGET" value="">
    <input type="hidden" name="__EVENTVALIDATION" value="validation">
    <input type="hidden" name="__VIEWSTATE" value="state">
    <table id="ctl00_ContentPlaceHolderSRIS_rdgrdManageTender_ctl00"><tbody>${rows}</tbody></table>
    <div class="rgPager">${pager}</div>
    <script>var grid={"_currentPageIndex":${currentPageIndex},"PageCount":${pageCount}};</script>
  </form>`;
}

function punjabPpraRow(id: number): string {
  return `<tr class="rgRow">
    <td>Tender Notice</td><td>Punjab procurement ${id}</td><td>Work</td><td>13 Jul 2026</td><td>14 Jul 2026</td>
    <td>District Council, Lahore</td><td>Violated Tender</td>
    <td><a href="/Tenders/50485054/4855/notice${id}.pdf">Notice</a></td>
    <td><a href="/BiddingDocuments/50485054/4855/bid${id}.pdf">Bidding</a></td>
  </tr>`;
}

function kpPpraListing(rows: string, start: number, end: number, total: number): string {
  return `<table class="table custom-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Showing ${start} - ${end} of ${total}</td></tr></tfoot>
  </table>`;
}

function kpPpraRow(tenderNumber: number): string {
  const noticeFile = tenderNumber === 32478
    ? "1784266143nit.jpg"
    : tenderNumber === 32484
      ? "1784268775cnwkohistanupper.pdf"
      : `${tenderNumber}notice.pdf`;
  const biddingDocument = tenderNumber === 32484
    ? `<a href="http://www.kppra.gov.pk/kppra/staff/force_download.php?file=dept/upload/1784268775cnwkohistanupperbidding.pdf">Download bidding</a>`
    : "Can be obtained from the P.E office";
  const noticeHref = tenderNumber === 32478
    ? `staff/force_download.php?file=dept/upload/${noticeFile}`
    : `http://www.kppra.gov.pk/kppra/staff/force_download.php?file=dept/upload/${noticeFile}`;
  return `<tr>
    <td>${tenderNumber}</td>
    <td>KP procurement ${tenderNumber}</td>
    <td>C&amp;W Division Kohistan Upper</td>
    <td>17-Jul-2026</td>
    <td>05-Aug-2026</td>
    <td><a href="${noticeHref}">Download notice</a></td>
    <td>${biddingDocument}</td>
    <td><a onclick="details(${tenderNumber + 3000})">Details</a></td>
  </tr>
  <tr style="display:none" id="item_temp_section_${tenderNumber}"><td colspan="8"><table class="NOEDITS"><tbody>
    <tr><th>Tender No</th><th>Corrigendum Description</th><th>Corrigendum Close Date</th><th>Corrigendum Created</th><th>Download</th></tr>
  </tbody></table></td></tr>`;
}

function kpPpraDetail(tenderNumber: number): string {
  const noticeFile = tenderNumber === 32478
    ? "1784266143nit.jpg"
    : tenderNumber === 32484
      ? "1784268775cnwkohistanupper.pdf"
      : `${tenderNumber}notice.pdf`;
  return JSON.stringify([{
    tender_id: String(tenderNumber + 3000),
    tender_ref: String(tenderNumber),
    tender_start_date: "2026-07-17",
    tender_close_date: "2026-08-05",
    tender_file: noticeFile,
    bidding_doc: tenderNumber === 32484 ? "1784268775cnwkohistanupperbidding.pdf" : "",
    tender_descp: `KP procurement ${tenderNumber}`,
    tender_domain: "0",
    t_title: tenderNumber % 2 === 0 ? "Goods" : "Works",
    proc_method_name: "",
    pkg: [],
    items: [],
    bids: []
  }]);
}

function bppraTender(id: number, tseNumber: string, status: string) {
  return {
    Id: id,
    TSENumber: tseNumber,
    TenderName: "Construction of B/T road",
    Agency: "Executive Engineer Provincial B&R",
    Department: "Communication Works, Physical Planning & Housing Department",
    District: "Sohbatpur",
    Category: "Road Works",
    ProcurementCategoryID: 3,
    TenderStatus: status,
    PublishedDate: "7/17/2026 12:00:00 AM",
    CloseDate: "8/3/2026 12:00:00 AM",
    CloseTime: "12:00 PM",
    OpenTime: "1:00 PM",
    EstCost: "Rs. 11,941,412",
    DocCost: "Rs. 3,000",
    IsESubmissionAllowed: false,
    IsManual: true,
    PType: "Tender",
    PersonName: "Jahangeer Ahmed",
    Designation: "Executive Engineer",
    Phone: "0838603044",
    Email: "xenrspur@gmail.com",
    tenderNoticeDoc: "BOQManual/works-report.pdf",
    CancelReason: status === "Cancel" ? "Due to some inadmissible reasons" : undefined
  };
}
