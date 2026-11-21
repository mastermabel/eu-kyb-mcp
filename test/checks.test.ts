import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEmailDomain, checkEuVat, lookupLei, ToolInputError } from "../src/checks";

describe("live tools (mocked upstream)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const mockFetch = (fn: (url: string) => unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(fn(String(url))), { status })));

  it("VIES: parses a valid response and normalises input", async () => {
    mockFetch(() => ({ isValid: true, requestDate: "2026-11-21T10:00:00.000Z", userError: "VALID", name: "EXAMPLE GMBH", address: "MUSTERSTR. 1\n12345 BERLIN", vatNumber: "123456789" }));
    const r = await checkEuVat({ vat_number: "de 123.456.789" });
    expect(r).toMatchObject({ country_code: "DE", vat_number: "123456789", valid: true, name: "EXAMPLE GMBH" });
    expect((fetch as any).mock.calls[0][0]).toContain("/ms/DE/vat/123456789");
  });
  it("VIES: maps Greece and rejects non-EU", async () => {
    mockFetch(() => ({ isValid: false, name: "---", address: "---" }));
    expect(await checkEuVat({ country_code: "GR", vat_number: "123456789" })).toMatchObject({ country_code: "EL", valid: false, name: null });
    await expect(checkEuVat({ country_code: "US", vat_number: "123" })).rejects.toBeInstanceOf(ToolInputError);
  });
  it("GLEIF: name search", async () => {
    mockFetch(() => ({ data: [{ id: "7LTWFZYICNSX8D621K86", attributes: { lei: "7LTWFZYICNSX8D621K86", entity: { legalName: { name: "Example AG" }, status: "ACTIVE", jurisdiction: "DE", legalAddress: { addressLines: ["Str. 1"], postalCode: "80333", city: "München", country: "DE" } }, registration: { status: "ISSUED" } } }] }));
    const r: any = await lookupLei({ name: "Example" });
    expect(r.found).toBe(true);
    expect(r.records[0]).toMatchObject({ legal_name: "Example AG", entity_status: "ACTIVE", legal_address: "Str. 1, 80333, München, DE" });
  });
  it("Email domain: MX, SPF, DMARC, disposable", async () => {
    mockFetch((url) => {
      if (url.includes("_dmarc")) return { Answer: [{ data: '"v=DMARC1; p=reject; rua=mailto:x@example.com"' }] };
      if (url.includes("type=MX")) return { Answer: [{ data: "10 mx1.example.com." }, { data: "20 mx2.example.com." }] };
      if (url.includes("type=TXT")) return { Answer: [{ data: '"v=spf1 include:_spf.example.com ~all"' }] };
      return { Answer: [{ data: "93.184.216.34" }] };
    });
    const r: any = await checkEmailDomain({ email: "Someone@Example.com" });
    expect(r).toMatchObject({ domain: "example.com", verdict: "deliverable_domain", has_mx: true, mx_hosts: ["mx1.example.com", "mx2.example.com"], dmarc_policy: "reject" });
    expect(r.spf).toMatch(/^v=spf1/);
    await expect(checkEmailDomain({ email: "bad" })).rejects.toBeInstanceOf(ToolInputError);
  });
  it("Email domain: null MX means cannot receive", async () => {
    mockFetch((url) => (url.includes("type=MX") ? { Answer: [{ data: "0 ." }] } : { Answer: [] }));
    expect(await checkEmailDomain({ domain: "nomail.example" })).toMatchObject({ verdict: "cannot_receive_mail", has_mx: false, null_mx: true });
  });
});
