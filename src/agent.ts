import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { connectDripMcp } from "./drip-mcp";

export type Lead = {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  role?: string;
  context?: string;
};

export type AgentEvent =
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; preview: string }
  | { kind: "final"; text: string }
  | { kind: "error"; error: string };

const SYSTEM_PROMPT = `You are an outbound sales agent for AK-DRIP.

Given a lead JSON, you will:
1. Write ONE personalized cold email — friendly, human, never spammy.
   - Subject: under 8 words, no clickbait.
   - Body: 3 to 5 short lines, plain text, signed "— AK".
   - Personalize with the lead's name, company, role, and any provided context.
2. Upsert the lead into Drip via drip_create_subscriber, including:
   - email
   - custom_fields: { first_name, last_name, company, role, ai_subject, ai_body }
   - tags: ["TEST-PLAY-A"]
3. Enroll the subscriber into the test campaign via drip_force_subscribe
   (NOT drip_subscribe_to_campaign), using the campaign_id supplied in the user
   message. drip_force_subscribe skips double opt-in so the campaign email
   fires immediately.
4. Track an event "agent_enrolled" via drip_track_event.

Then output a final JSON block with these fields:
{
  "email_subject": "...",
  "email_body": "...",
  "subscriber_id": "...",
  "tag_applied": "TEST-PLAY-A",
  "campaign_id": "...",
  "status": "enrolled"
}

Rules:
- Do NOT ask the user for clarification. Generate the email yourself.
- Use each Drip tool at most once unless a call fails.
- Be concise in any non-tool reasoning.`;

const MAX_TURNS = 12;

const ALLOWED_MCP_TOOLS = new Set([
  "drip_create_subscriber",
  "drip_subscribe_to_campaign",
  "drip_track_event",
  "drip_list_campaigns",
]);

function dripAuthHeaders() {
  const auth = Buffer.from((process.env.DRIP_API_KEY ?? "") + ":").toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function dripBase() {
  return `https://api.getdrip.com/v2/${process.env.DRIP_ACCOUNT_ID}`;
}

async function dripForceSubscribe(
  email: string,
  campaignId: string,
): Promise<{ ok: boolean; preview: string }> {
  const body = JSON.stringify({ subscribers: [{ email, double_optin: false }] });
  const r = await fetch(`${dripBase()}/campaigns/${campaignId}/subscribers`, {
    method: "POST",
    headers: dripAuthHeaders(),
    body,
  });
  const text = await r.text();
  return { ok: r.status < 400, preview: `HTTP ${r.status}\n${text.slice(0, 500)}` };
}

export async function* runAgent(
  lead: Lead,
  campaignId: string,
): AsyncGenerator<AgentEvent, void, void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    yield { kind: "error", error: "Missing OPENROUTER_API_KEY in env" };
    return;
  }

  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  let mcp: Awaited<ReturnType<typeof connectDripMcp>> | null = null;
  try {
    mcp = await connectDripMcp();
    const { tools: mcpTools } = await mcp.listTools();

    const tools: ChatCompletionTool[] = mcpTools
      .filter((t) => ALLOWED_MCP_TOOLS.has(t.name))
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description ?? "",
          parameters: (t.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
          },
        },
      }));

    tools.push({
      type: "function",
      function: {
        name: "drip_force_subscribe",
        description:
          "Subscribe a lead to a Drip Email Series Campaign with double_optin=false (skips confirmation, fires first email immediately). Use INSTEAD of drip_subscribe_to_campaign when you want the email to send right away.",
        parameters: {
          type: "object",
          properties: {
            email: { type: "string" },
            campaign_id: { type: "string" },
          },
          required: ["email", "campaign_id"],
        },
      },
    });

    const userMessage = `Lead JSON:
\`\`\`json
${JSON.stringify(lead, null, 2)}
\`\`\`

Drip campaign_id to enroll into: ${campaignId}

Run the full flow now.`;

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];
    let lastText = "";

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        tools,
        messages,
      });

      const choice = response.choices[0];
      const message = choice.message;
      const text = message.content?.trim() ?? "";
      if (text) {
        lastText = text;
        yield { kind: "thinking", text };
      }

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0 || choice.finish_reason === "stop") {
        yield { kind: "final", text: lastText };
        return;
      }

      messages.push(message);

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || "{}");
        } catch {
          parsedArgs = {};
        }

        yield {
          kind: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: parsedArgs,
        };

        const result = await callTool(
          tc.function.name,
          parsedArgs,
          mcp,
          campaignId,
        );

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.text || (result.ok ? "ok" : "error"),
        });

        yield {
          kind: "tool_result",
          toolUseId: tc.id,
          ok: result.ok,
          preview: result.text.slice(0, 600),
        };
      }
    }

    yield { kind: "error", error: `Hit max turns (${MAX_TURNS}) without final` };
  } catch (err) {
    yield {
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (mcp) await mcp.close().catch(() => {});
  }
}

async function callTool(
  name: string,
  input: Record<string, unknown>,
  mcp: NonNullable<Awaited<ReturnType<typeof connectDripMcp>>>,
  campaignId: string,
): Promise<{ ok: boolean; text: string }> {
  if (name === "drip_force_subscribe") {
    const r = await dripForceSubscribe(
      String(input.email ?? ""),
      String(input.campaign_id ?? campaignId),
    );
    return { ok: r.ok, text: r.preview };
  }

  try {
    const res = await mcp.callTool({ name, arguments: input });
    const content = (res.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    return { ok: !res.isError, text };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}
