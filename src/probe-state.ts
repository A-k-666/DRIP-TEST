import "dotenv/config";

(async () => {
  const auth = Buffer.from(process.env.DRIP_API_KEY + ":").toString("base64");
  const accountId = process.env.DRIP_ACCOUNT_ID;
  const campaignId = process.env.DRIP_TEST_CAMPAIGN_ID;
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  const url = `https://api.getdrip.com/v2/${accountId}/campaigns/${campaignId}/subscribers?per_page=2&direction=desc`;
  const res = await fetch(url, { headers });
  const data: any = await res.json();
  const sub = data?.subscribers?.[0];
  console.log("Sample subscriber object keys:");
  console.log(Object.keys(sub ?? {}).sort());
  console.log("\nFull sample (first sub):");
  console.log(JSON.stringify(sub, null, 2).slice(0, 2000));
})();
