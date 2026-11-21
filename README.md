# eu-kyb-mcp

**MCP server for EU know-your-business checks** – give your AI agent authoritative answers before it invoices, onboards a supplier or pays an unknown company.

| Tool | What it does | Source |
|---|---|---|
| `check_eu_vat` | Validates an EU VAT number; returns registered name/address where the member state discloses them | [EU VIES](https://ec.europa.eu/taxation_customs/vies/) |
| `lookup_lei` | Finds a legal entity by LEI or name: legal name, status, jurisdiction, address | [GLEIF](https://www.gleif.org/) |
| `check_email_domain` | MX, SPF, DMARC and a disposable-provider heuristic for an email domain (no mails sent) | DNS over HTTPS (1.1.1.1) |
| `request_verification_report` | *Optional:* asks [AgentSupply](https://agentsupply.dev) for a human-reviewed company verification report | AgentSupply (third party) |

No API keys. Results include a `source` field your agent can cite.

## Use it

**Hosted, nothing to install** – the same checks are available as a remote MCP server:
`https://agentsupply.dev/mcp` (Streamable HTTP).

**Local (stdio)** – Claude Desktop, Cursor and other MCP clients:

```json
{
  "mcpServers": {
    "eu-kyb": {
      "command": "npx",
      "args": ["-y", "github:mastermabel/eu-kyb-mcp"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add eu-kyb -- npx -y github:mastermabel/eu-kyb-mcp
```

From source:

```bash
git clone https://github.com/mastermabel/eu-kyb-mcp && cd eu-kyb-mcp
npm install && npm run build
node dist/index.js
```

## Examples

```text
Is DE811569869 a valid VAT number?               -> check_eu_vat
What is the LEI of Siemens Aktiengesellschaft?   -> lookup_lei
Can billing@example-shop.eu receive email?       -> check_email_domain
```

## Privacy

Inputs are sent only to the public source needed for the check (VIES, GLEIF, Cloudflare DNS).
`request_verification_report` sends the request content to AgentSupply and is only exposed as a tool when not disabled;
set `EU_KYB_DISABLE_AGENTSUPPLY=1` to remove it.

## Limitations

- VIES availability depends on the member states; some never disclose name/address.
- GLEIF only covers entities that hold an LEI.
- Email checks are domain-level; mailbox existence is not probed.
- Results are informational and come without warranty.

## License

MIT · Maintained by the team behind [AgentSupply](https://agentsupply.dev) – services for autonomous AI agents.
