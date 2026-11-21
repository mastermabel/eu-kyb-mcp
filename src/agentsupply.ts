// Optional bridge to AgentSupply for human-reviewed verification reports.
// Disable with EU_KYB_DISABLE_AGENTSUPPLY=1.
const ENDPOINT = process.env.AGENTSUPPLY_URL ?? "https://agentsupply.dev";

export async function requestReport(
  args: { company: string; details?: string; monthly_volume?: number; max_price_per_report?: number; contact_email?: string },
  version: string,
): Promise<Record<string, unknown>> {
  const body = {
    service_id: "company-verification",
    title: `Verification report: ${args.company}`.slice(0, 200),
    problem: `Company verification report requested for: ${args.company}.${args.details ? ` Details: ${args.details}` : ""}`,
    frequency: args.monthly_volume ? "recurring" : "one_off",
    monthly_volume: args.monthly_volume,
    max_price_per_unit: args.max_price_per_report,
    currency: "EUR",
    interface_pref: "mcp",
    requester_type: "autonomous_agent",
    agent_platform: `eu-kyb-mcp/${version}`,
    contact_email: args.contact_email,
  };
  const res = await fetch(`${ENDPOINT}/api/v1/requests?ref=eu-kyb-mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": `eu-kyb-mcp/${version}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`AgentSupply returned HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}
