import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent, type Lead } from "./agent.js";

async function main() {
  const leadPath = process.argv[2] ?? "samples/lead.json";
  const campaignId = process.env.DRIP_TEST_CAMPAIGN_ID;

  if (!campaignId) {
    throw new Error("Missing DRIP_TEST_CAMPAIGN_ID in .env");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY in .env — agent cannot run.");
  }

  const raw = readFileSync(resolve(process.cwd(), leadPath), "utf8");
  const lead = JSON.parse(raw) as Lead;

  console.log(`\n📥 Lead: ${lead.email} (${lead.first_name ?? ""} ${lead.last_name ?? ""}) @ ${lead.company ?? "?"}`);
  console.log(`📧 Campaign: ${campaignId}\n`);
  console.log("─".repeat(60));

  for await (const evt of runAgent(lead, campaignId)) {
    switch (evt.kind) {
      case "thinking":
        console.log(`\n💭 ${truncate(evt.text, 600)}`);
        break;
      case "tool_use":
        console.log(`\n🔧 → ${evt.name}`);
        console.log(`   ${JSON.stringify(evt.input).slice(0, 300)}`);
        break;
      case "tool_result":
        console.log(`   ${evt.ok ? "✅" : "❌"} ${truncate(evt.preview, 200)}`);
        break;
      case "final":
        console.log("\n" + "─".repeat(60));
        console.log("✅ DONE");
        console.log(evt.text);
        break;
      case "error":
        console.log("\n❌ ERROR:", evt.error);
        process.exit(1);
    }
  }
  process.exit(0);
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
