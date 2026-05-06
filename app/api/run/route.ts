import "dotenv/config";
import { runAgent, type Lead } from "../../../src/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const campaignId = process.env.DRIP_TEST_CAMPAIGN_ID;
  if (!campaignId) {
    return new Response("Missing DRIP_TEST_CAMPAIGN_ID", { status: 500 });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return new Response("Missing OPENROUTER_API_KEY", { status: 500 });
  }

  let lead: Lead;
  try {
    lead = (await req.json()) as Lead;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!lead?.email) {
    return new Response("lead.email is required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        for await (const evt of runAgent(lead, campaignId)) {
          send(evt);
        }
      } catch (err) {
        send({
          kind: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
