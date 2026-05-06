import "dotenv/config";
import { connectDripMcp } from "./drip-mcp.js";

async function main() {
  console.log("Booting Drip MCP server via stdio...");
  const client = await connectDripMcp();

  const { tools } = await client.listTools();
  console.log(`\nMCP exposed ${tools.length} tools. First few:`);
  for (const t of tools.slice(0, 8)) console.log(`  - ${t.name}`);

  console.log("\nCalling drip_list_campaigns ...");
  const res = await client.callTool({
    name: "drip_list_campaigns",
    arguments: { status: "active" },
  });

  const content = (res.content as Array<{ type: string; text?: string }>) ?? [];
  const text = content.find((c) => c.type === "text")?.text ?? "";
  console.log("\nRaw response (first 1500 chars):");
  console.log(text.slice(0, 1500));

  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const campaigns = parsed?.campaigns ?? parsed?.data?.campaigns ?? parsed ?? [];
  const list = Array.isArray(campaigns) ? campaigns : [];
  const testPlay = list.find((c: any) =>
    String(c?.name ?? "").toUpperCase().includes("TEST-PLAY-A"),
  );

  console.log(`\nFound ${list.length} active campaign(s).`);
  if (testPlay) {
    console.log(`✅ TEST-PLAY-A located. id=${testPlay.id} status=${testPlay.status}`);
  } else {
    console.log("⚠️  TEST-PLAY-A not found in active list — confirm it is Active in Drip.");
  }

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
