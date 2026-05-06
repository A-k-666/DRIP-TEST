import "dotenv/config";

(async () => {
  const auth = Buffer.from(process.env.DRIP_API_KEY + ":").toString("base64");
  const url = `https://api.getdrip.com/v2/${process.env.DRIP_ACCOUNT_ID}/campaigns/${process.env.DRIP_TEST_CAMPAIGN_ID}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const data: any = await res.json();
  const c = data.campaigns?.[0] ?? data;
  console.log("double_optin               :", c.double_optin);
  console.log("status                     :", c.status);
  console.log("active_subscriber_count    :", c.active_subscriber_count);
  console.log("email_count                :", c.email_count);
  console.log("send_to_confirmation_page  :", c.send_to_confirmation_page);
  console.log("start_immediately          :", c.start_immediately);
  console.log("days_of_the_week_mask      :", c.days_of_the_week_mask);
  console.log("minutes_from_midnight      :", c.minutes_from_midnight);
})();
