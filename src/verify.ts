import "dotenv/config";
import { connectDripMcp } from "./drip-mcp.js";

async function fetchDrip(path: string) {
  const auth = Buffer.from((process.env.DRIP_API_KEY ?? "") + ":").toString("base64");
  const accountId = process.env.DRIP_ACCOUNT_ID;
  const url = `https://api.getdrip.com/v2/${accountId}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  const arg = process.argv[2];

  if (arg === "force-start") {
    const email = process.argv[3];
    if (!email) {
      console.log("Usage: pnpm diagnose force-start <email>");
      return;
    }
    const campaignId = process.env.DRIP_TEST_CAMPAIGN_ID;
    console.log(`\nForce-starting ${email} on campaign ${campaignId} (double_optin=false)...\n`);
    const auth = Buffer.from((process.env.DRIP_API_KEY ?? "") + ":").toString("base64");
    const baseUrl = `https://api.getdrip.com/v2/${process.env.DRIP_ACCOUNT_ID}`;
    const headers = {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    console.log("Step 1: removing existing campaign subscription...");
    const r1 = await fetch(
      `${baseUrl}/subscribers/${encodeURIComponent(email)}/remove`,
      { method: "POST", headers, body: JSON.stringify({ campaign_id: campaignId }) },
    );
    console.log(`  HTTP ${r1.status}`);

    console.log("Step 2: re-subscribing with double_optin=false...");
    const r2 = await fetch(`${baseUrl}/campaigns/${campaignId}/subscribers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subscribers: [{ email, double_optin: false }],
      }),
    });
    const text2 = await r2.text();
    console.log(`  HTTP ${r2.status}`);
    console.log(text2.slice(0, 800));
    return;
  }

  if (arg === "campaign") {
    const campaignId = process.env.DRIP_TEST_CAMPAIGN_ID;
    console.log(`\n📧 Campaign ${campaignId} — recent subscribers + send state:\n`);
    const { data } = await fetchDrip(
      `/campaigns/${campaignId}/subscribers?per_page=10&direction=desc`,
    );
    const subs = data?.subscribers ?? [];
    if (subs.length === 0) {
      console.log("  (no subscribers in this campaign — something is wrong)");
    }
    for (const s of subs) {
      const aiSubj = s.custom_fields?.ai_subject ? "✓" : "·";
      const aiBody = s.custom_fields?.ai_body ? "✓" : "·";
      const tags = (s.tags ?? []).join(",") || "—";
      console.log(`  ${(s.email ?? "?").padEnd(38)}`);
      console.log(`     status: ${s.status}    subscribed_at: ${s.created_at}`);
      console.log(`     tags: ${tags}    ai_subj=${aiSubj} ai_body=${aiBody}`);
      console.log("");
    }
    console.log(`Note: per-subscriber send state (confirmed_at, last_sent_at)`);
    console.log(`is NOT exposed by this endpoint. To verify a send actually`);
    console.log(`went out, check the recipient's inbox/spam folder directly.`);
    return;
  }

  const client = await connectDripMcp();

  if (!arg) {
    // List mode — show last 10 subscribers
    const res = await client.callTool({
      name: "drip_list_subscribers",
      arguments: { per_page: 10, sort: "created_at", direction: "desc" },
    });
    const text =
      (res.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === "text",
      )?.text ?? "";
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    const subs = parsed?.subscribers ?? [];
    console.log(`\nLast ${subs.length} subscribers (newest first):\n`);
    for (const s of subs) {
      const aiSubj = s.custom_fields?.ai_subject ? "✓" : "·";
      const aiBody = s.custom_fields?.ai_body ? "✓" : "·";
      console.log(
        `  ${(s.email ?? "?").padEnd(38)}` +
          ` status=${(s.status ?? "?").padEnd(12)}` +
          ` ai_subj=${aiSubj} ai_body=${aiBody}` +
          ` created=${s.created_at ?? "—"}`,
      );
    }
    console.log(`\nFor full detail: pnpm diagnose <email>`);
    await client.close();
    return;
  }

  // Detail mode (pass email or ID — Drip API accepts both as subscriber_id)
  const sub = await client.callTool({
    name: "drip_get_subscriber",
    arguments: { subscriber_id: arg },
  });
  const text =
    (sub.content as Array<{ type: string; text?: string }>)?.find(
      (c) => c.type === "text",
    )?.text ?? "";
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!parsed || parsed.errors) {
    console.log(`❌ ${arg} not found.`);
    console.log(text.slice(0, 600));
    await client.close();
    return;
  }

  console.log(`\n📋 Subscriber: ${parsed.email}`);
  console.log(`  ID            : ${parsed.id}`);
  console.log(`  Status        : ${parsed.status}`);
  console.log(`  Created       : ${parsed.created_at}`);
  console.log(`  Tags          : ${JSON.stringify(parsed.tags ?? [])}`);

  const cf = parsed.custom_fields ?? {};
  console.log(`\n  Custom fields:`);
  if (Object.keys(cf).length === 0) {
    console.log(`    (none)`);
  } else {
    for (const [k, v] of Object.entries(cf)) {
      const preview = String(v).slice(0, 100);
      const more = String(v).length > 100 ? "…" : "";
      console.log(`    ${k}: ${preview}${more}`);
    }
  }

  console.log(
    `\n  ai_subject path test → ${cf.ai_subject ? "✓ has value" : "✗ MISSING"}`,
  );
  console.log(
    `  ai_body    path test → ${cf.ai_body ? "✓ has value" : "✗ MISSING"}`,
  );

  await client.close();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
