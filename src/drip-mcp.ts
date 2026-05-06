import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = resolve(__dirname, "drip-mcp-bootstrap.mjs");

export async function connectDripMcp() {
  const apiKey = process.env.DRIP_API_KEY;
  const accountId = process.env.DRIP_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    throw new Error("Missing DRIP_API_KEY or DRIP_ACCOUNT_ID in .env");
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BOOTSTRAP],
    env: {
      ...process.env,
      DRIP_API_KEY: apiKey,
      DRIP_ACCOUNT_ID: accountId,
    },
  });

  const client = new Client({ name: "ak-drip-agent", version: "0.1.0" });
  await client.connect(transport);
  return client;
}
