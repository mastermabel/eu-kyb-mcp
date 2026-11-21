// Checks backed by authoritative public sources: EU VIES, GLEIF and DNS over HTTPS.

export class ToolInputError extends Error {}

const EU_VAT_COUNTRIES = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];


async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", "user-agent": "eu-kyb-mcp/0.1 (+https://github.com/mastermabel/eu-kyb-mcp)", ...(init?.headers ?? {}) } });
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ VIES
export async function checkEuVat(args: Record<string, unknown>) {
  let cc = String(args.country_code ?? "").trim().toUpperCase();
  let num = String(args.vat_number ?? "").replace(/[\s.\-]/g, "").toUpperCase();
  if (!cc && /^[A-Z]{2}/.test(num)) cc = num.slice(0, 2);
  if (cc === "GR") cc = "EL";
  if (num.startsWith(cc)) num = num.slice(2);
  if (!EU_VAT_COUNTRIES.includes(cc)) throw new ToolInputError(`country_code must be an EU member state code (${EU_VAT_COUNTRIES.join(", ")}).`);
  if (!/^[0-9A-Z+*]{2,14}$/.test(num)) throw new ToolInputError("vat_number has an invalid format.");

  const { status, body } = await fetchJson(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${encodeURIComponent(num)}`);
  if (status !== 200 || typeof body?.isValid !== "boolean") {
    return { country_code: cc, vat_number: num, valid: null, error: body?.userError ?? body?.errorWrappers?.[0]?.error ?? `VIES returned HTTP ${status}`, source: "VIES (European Commission)", note: "VIES or the member state registry may be temporarily unavailable; retry later." };
  }
  const clean = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "---" ? v.trim() : null);
  return {
    country_code: cc,
    vat_number: num,
    valid: body.isValid,
    name: clean(body.name),
    address: clean(body.address),
    request_date: body.requestDate ?? null,
    source: "VIES (European Commission)",
    note: "Name/address are only returned when the member state discloses them.",
  };
}

// ------------------------------------------------------------------ GLEIF
function summariseLei(rec: any) {
  const a = rec?.attributes ?? {};
  const e = a.entity ?? {};
  const addr = e.legalAddress ?? {};
  return {
    lei: a.lei ?? rec?.id,
    legal_name: e.legalName?.name ?? null,
    entity_status: e.status ?? null,
    legal_form: e.legalForm?.id ?? null,
    jurisdiction: e.jurisdiction ?? null,
    legal_address: [addr.addressLines?.join(", "), addr.postalCode, addr.city, addr.country].filter(Boolean).join(", ") || null,
    registered_as: e.registeredAs ?? null,
    registration_status: a.registration?.status ?? null,
    last_update: a.registration?.lastUpdateDate ?? null,
  };
}

export async function lookupLei(args: Record<string, unknown>) {
  const lei = String(args.lei ?? "").trim().toUpperCase();
  const name = String(args.name ?? "").trim();
  const base = "https://api.gleif.org/api/v1/lei-records";
  if (lei) {
    if (!/^[A-Z0-9]{20}$/.test(lei)) throw new ToolInputError("lei must be 20 alphanumeric characters.");
    const { status, body } = await fetchJson(`${base}/${lei}`, { headers: { accept: "application/vnd.api+json" } });
    if (status === 404) return { query: { lei }, found: false, records: [], source: "GLEIF Global LEI Index" };
    if (status !== 200) return { query: { lei }, found: null, error: `GLEIF returned HTTP ${status}`, source: "GLEIF Global LEI Index" };
    return { query: { lei }, found: true, records: [summariseLei(body.data)], source: "GLEIF Global LEI Index" };
  }
  if (name.length < 2 || name.length > 200) throw new ToolInputError("Provide either 'lei' or 'name' (2–200 characters).");
  const opts = { headers: { accept: "application/vnd.api+json" } };
  // Exact legal-name matches first, then full-text matches (which also hit subsidiaries "c/o …").
  const [exact, full] = await Promise.all([
    fetchJson(`${base}?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=5`, opts),
    fetchJson(`${base}?filter[fulltext]=${encodeURIComponent(name)}&page[size]=5`, opts),
  ]);
  if (exact.status !== 200 && full.status !== 200) return { query: { name }, found: null, error: `GLEIF returned HTTP ${full.status}`, source: "GLEIF Global LEI Index" };
  const seen = new Set<string>();
  const records = [...(exact.status === 200 ? exact.body.data ?? [] : []), ...(full.status === 200 ? full.body.data ?? [] : [])]
    .map(summariseLei)
    .filter((r: { lei: string }) => !seen.has(r.lei) && !!seen.add(r.lei))
    .slice(0, 5);
  return { query: { name }, found: records.length > 0, records, source: "GLEIF Global LEI Index", note: "Only entities holding an LEI are covered." };
}

// ------------------------------------------------------------------ Email domain
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com",
  "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
  "emailondeck.com", "mohmal.com", "tempail.com", "burnermail.io", "spamgourmet.com", "mailnesia.com",
]);

async function doh(name: string, type: string): Promise<string[]> {
  const { status, body } = await fetchJson(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" } }, 5000);
  if (status !== 200 || !Array.isArray(body?.Answer)) return [];
  return body.Answer.map((a: any) => String(a.data));
}

export async function checkEmailDomain(args: Record<string, unknown>) {
  const input = String(args.email ?? args.domain ?? "").trim().toLowerCase();
  const domain = input.includes("@") ? input.split("@").pop()! : input;
  if (!/^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) throw new ToolInputError("Provide a valid 'email' or 'domain'.");

  const [mx, txt, dmarc, a] = await Promise.all([doh(domain, "MX"), doh(domain, "TXT"), doh(`_dmarc.${domain}`, "TXT"), doh(domain, "A")]);
  const mxHosts = mx.map((r) => r.split(/\s+/).pop()!.replace(/\.$/, "")).filter((h) => h && h !== "");
  const nullMx = mx.some((r) => /^0\s+\.?$/.test(r.trim()));
  const spf = txt.map((t) => t.replace(/^"|"$/g, "").replace(/" "/g, "")).find((t) => t.startsWith("v=spf1")) ?? null;
  const dmarcRec = dmarc.map((t) => t.replace(/^"|"$/g, "").replace(/" "/g, "")).find((t) => t.startsWith("v=DMARC1")) ?? null;
  const dmarcPolicy = dmarcRec?.match(/;\s*p=(\w+)/)?.[1] ?? null;
  const disposable = DISPOSABLE.has(domain);
  const canReceive = !nullMx && (mxHosts.length > 0 || a.length > 0);

  let verdict = "deliverable_domain";
  if (!canReceive) verdict = "cannot_receive_mail";
  else if (disposable) verdict = "disposable_provider";
  else if (!mxHosts.length) verdict = "no_mx_fallback_a_record";

  return {
    domain,
    verdict,
    has_mx: mxHosts.length > 0 && !nullMx,
    mx_hosts: mxHosts.slice(0, 10),
    null_mx: nullMx,
    spf: spf,
    dmarc: dmarcRec,
    dmarc_policy: dmarcPolicy,
    disposable_heuristic: disposable,
    source: "DNS over HTTPS (Cloudflare 1.1.1.1)",
    note: "Domain-level checks only. No email is sent and mailbox existence is not probed.",
  };
}

