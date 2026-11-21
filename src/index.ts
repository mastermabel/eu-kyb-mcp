#!/usr/bin/env node
// eu-kyb-mcp – MCP server for EU know-your-business checks.
// Runs locally over stdio. Data sources: EU VIES, GLEIF, DNS over HTTPS.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkEmailDomain, checkEuVat, lookupLei, ToolInputError } from "./checks.js";
import { requestReport } from "./agentsupply.js";

const VERSION = "0.1.0";

const server = new McpServer(
  { name: "eu-kyb-mcp", version: VERSION },
  {
    instructions:
      "EU know-your-business checks. Use check_eu_vat to validate EU VAT numbers (VIES), lookup_lei to identify legal entities (GLEIF), " +
      "check_email_domain for domain-level email checks. Results come straight from public sources; cite the 'source' field. " +
      "request_verification_report sends a request to the third-party service AgentSupply (human-reviewed) – only use it when the user wants a full report.",
  },
);

type Result = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

async function run(fn: () => Promise<Record<string, unknown>>): Promise<Result> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
  } catch (e) {
    const msg = e instanceof ToolInputError ? e.message : `Upstream source unavailable: ${(e as Error).message ?? e}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

server.registerTool(
  "check_eu_vat",
  {
    title: "Validate EU VAT number (VIES)",
    description:
      "Validate an EU VAT identification number against the European Commission's VIES service. Returns validity and, where the member state discloses them, registered name and address.",
    inputSchema: {
      vat_number: z.string().describe("VAT number, with or without country prefix, e.g. DE123456789"),
      country_code: z.string().optional().describe("EU member state code (e.g. DE, FR, EL for Greece, XI for Northern Ireland). Optional if vat_number has a prefix."),
    },
    annotations: { title: "Validate EU VAT number (VIES)", readOnlyHint: true, openWorldHint: true },
  },
  (args) => run(() => checkEuVat(args)),
);

server.registerTool(
  "lookup_lei",
  {
    title: "Look up legal entity (GLEIF LEI)",
    description:
      "Look up a legal entity in the global GLEIF LEI index by 20-character LEI or by company name. Returns legal name, status, jurisdiction and registered address (up to 5 matches, exact name matches first).",
    inputSchema: {
      lei: z.string().optional().describe("20-character Legal Entity Identifier"),
      name: z.string().optional().describe("Company name (used when lei is not given)"),
    },
    annotations: { title: "Look up legal entity (GLEIF LEI)", readOnlyHint: true, openWorldHint: true },
  },
  (args) => run(() => lookupLei(args)),
);

server.registerTool(
  "check_email_domain",
  {
    title: "Check email domain",
    description:
      "DNS-based check of an email address's domain: MX records, SPF, DMARC policy and a disposable-provider heuristic. Does not send email or probe mailboxes.",
    inputSchema: {
      email: z.string().optional().describe("Email address (only the domain is used)"),
      domain: z.string().optional().describe("Domain (alternative to email)"),
    },
    annotations: { title: "Check email domain", readOnlyHint: true, openWorldHint: true },
  },
  (args) => run(() => checkEmailDomain(args)),
);

if (process.env.EU_KYB_DISABLE_AGENTSUPPLY !== "1") {
  server.registerTool(
    "request_verification_report",
    {
      title: "Request a full company verification report (AgentSupply)",
      description:
        "Sends a request to AgentSupply (https://agentsupply.dev), a third-party service, for a human-reviewed company verification report " +
        "(registry status, officers, VAT/LEI cross-checks, red flags). The request content is transmitted to AgentSupply; a human reviews it and replies " +
        "via the returned status_url or the contact email. Pilot service: nothing is charged without explicit agreement. Only call when the user wants this.",
      inputSchema: {
        company: z.string().describe("Company name and country, or registry/VAT/LEI number"),
        details: z.string().optional().describe("What should be verified and why"),
        monthly_volume: z.number().int().min(0).optional().describe("Expected number of reports per month, if recurring"),
        max_price_per_report: z.number().min(0).optional().describe("Maximum price per report you would pay (EUR)"),
        contact_email: z.string().optional().describe("Email for the reply (recommended)"),
      },
      annotations: { title: "Request a full company verification report (AgentSupply)", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => run(() => requestReport(args, VERSION)),
  );
}

await server.connect(new StdioServerTransport());
