import { describe, expect, it } from "vitest";
import { parseHtmlDocument } from "@tenderlo/parsing";

describe("local parsing", () => {
  it("extracts HTML text without scripts", () => {
    const result = parseHtmlDocument("<html><body><script>bad()</script><main><h1>Tender notice</h1><p>Closing date 30/06/2026</p></main></body></html>");
    expect(result.parserStatus).toBe("parsed");
    expect(result.pages[0]?.text).toContain("Tender notice");
    expect(result.pages[0]?.text).not.toContain("bad");
  });
});
