import "dotenv/config";

async function fetchDrip(path: string, init: RequestInit = {}) {
  const auth = Buffer.from((process.env.DRIP_API_KEY ?? "") + ":").toString("base64");
  const accountId = process.env.DRIP_ACCOUNT_ID;
  const url = `https://api.getdrip.com/v2/${accountId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  const arg = process.argv[2];

  if (arg === "campaign") {
    const campaignId = process.env.DRIP_TEST_CAMPAIGN_ID;
    console.log(`\n📧 Campaign ${campaignId} — recent subscribers:\n`);
    const { data } = await fetchDrip(
      `/campaigns/${campaignId}/subscribers?per_page=10&direction=desc`,
    );
    const subs = data?.subscribers ?? [];
    for (const s of subs) {
      const aiSubj = s.custom_fields?.ai_subject ? "✓" : "·";
      const aiBody = s.custom_fields?.ai_body ? "✓" : "·";
      console.log(`  ${(s.email ?? "?").padEnd(38)} status=${s.status}  ai_subj=${aiSubj} ai_body=${aiBody}`);
    }
    return;
  }

  if (!arg) {
    const { data } = await fetchDrip("/subscribers?per_page=10&sort=created_at&direction=desc");
    const subs = data?.subscribers ?? [];
    console.log(`\nLast ${subs.length} subscribers (newest first):\n`);
    for (const s of subs) {
      const aiSubj = s.custom_fields?.ai_subject ? "✓" : "·";
      const aiBody = s.custom_fields?.ai_body ? "✓" : "·";
      console.log(
        `  ${(s.email ?? "?").padEnd(38)} status=${(s.status ?? "?").padEnd(12)} ai_subj=${aiSubj} ai_body=${aiBody}`,
      );
    }
    console.log(`\nFor full detail: pnpm diagnose <email>`);
    return;
  }

  const { data, status } = await fetchDrip(`/subscribers/${encodeURIComponent(arg)}`);
  if (status >= 400) {
    console.log(`❌ ${arg} not found (HTTP ${status})`);
    return;
  }
  const sub = data.subscribers?.[0] ?? data;
  console.log(`\n📋 Subscriber: ${sub.email}`);
  console.log(`  ID            : ${sub.id}`);
  console.log(`  Status        : ${sub.status}`);
  console.log(`  Tags          : ${JSON.stringify(sub.tags ?? [])}`);
  console.log(`  Custom fields :`);
  for (const [k, v] of Object.entries(sub.custom_fields ?? {})) {
    const preview = String(v).slice(0, 100);
    console.log(`    ${k}: ${preview}${String(v).length > 100 ? "…" : ""}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
