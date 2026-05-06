import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

async function dripFetch(path: string, init: RequestInit = {}) {
  const auth = Buffer.from((process.env.DRIP_API_KEY ?? "") + ":").toString("base64");
  const url = `https://api.getdrip.com/v2/${process.env.DRIP_ACCOUNT_ID}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, text };
}

export const dripExtras = createSdkMcpServer({
  name: "akdrip",
  version: "0.1.0",
  tools: [
    tool(
      "drip_force_subscribe",
      "Subscribe an email to a Drip Email Series Campaign with double_optin=false. This skips the confirmation step and starts the email series immediately. If the email is already subscribed but unconfirmed, it removes the existing subscription first and re-adds with confirmation skipped. Use this INSTEAD of drip_subscribe_to_campaign.",
      {
        email: z.string().email(),
        campaign_id: z.string(),
      },
      async ({ email, campaign_id }) => {
        const payload = JSON.stringify({
          subscribers: [{ email, double_optin: false }],
        });

        let r = await dripFetch(`/campaigns/${campaign_id}/subscribers`, {
          method: "POST",
          body: payload,
        });

        if (r.status === 422 && /already\s+subscribed/i.test(r.text)) {
          await dripFetch(`/subscribers/${encodeURIComponent(email)}/remove`, {
            method: "POST",
            body: JSON.stringify({ campaign_id }),
          });
          r = await dripFetch(`/campaigns/${campaign_id}/subscribers`, {
            method: "POST",
            body: payload,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `HTTP ${r.status}\n${r.text.slice(0, 600)}`,
            },
          ],
          isError: r.status >= 400,
        };
      },
    ),
  ],
});
