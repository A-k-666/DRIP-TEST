import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

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
3. Enroll the subscriber into the test campaign via drip_subscribe_to_campaign,
   using the campaign_id supplied in the user message.
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

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "drip_create_subscriber",
      description:
        "Create or update a subscriber in Drip. Stores custom fields and applies tags.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string", description: "Lead email" },
          custom_fields: {
            type: "object",
            description: "Custom fields like first_name, last_name, company, role, ai_subject, ai_body",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to apply",
          },
        },
        required: ["email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "drip_subscribe_to_campaign",
      description:
        "Enroll a subscriber into a Drip Email Series Campaign with double_optin=false (skips confirmation, fires the first email immediately).",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          campaign_id: { type: "string" },
        },
        required: ["email", "campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "drip_track_event",
      description: "Track a custom behavioral event for a subscriber.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          action: { type: "string", description: "Event name, e.g. agent_enrolled" },
        },
        required: ["email", "action"],
      },
    },
  },
];

function dripHeaders() {
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

async function callDripTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const headers = dripHeaders();
  const base = dripBase();

  if (name === "drip_create_subscriber") {
    const res = await fetch(`${base}/subscribers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subscribers: [input] }),
    });
    const text = await res.text();
    return { ok: res.status < 400, text: `HTTP ${res.status}\n${text.slice(0, 500)}` };
  }

  if (name === "drip_subscribe_to_campaign") {
    const email = String(input.email ?? "");
    const campaignId = String(input.campaign_id ?? "");
    const body = JSON.stringify({ subscribers: [{ email, double_optin: false }] });

    let res = await fetch(`${base}/campaigns/${campaignId}/subscribers`, {
      method: "POST",
      headers,
      body,
    });
    if (
      res.status === 422 &&
      /already\s+subscribed/i.test(await res.clone().text())
    ) {
      await fetch(`${base}/subscribers/${encodeURIComponent(email)}/remove`, {
        method: "POST",
        headers,
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      res = await fetch(`${base}/campaigns/${campaignId}/subscribers`, {
        method: "POST",
        headers,
        body,
      });
    }
    const text = await res.text();
    return { ok: res.status < 400, text: `HTTP ${res.status}\n${text.slice(0, 500)}` };
  }

  if (name === "drip_track_event") {
    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: [input] }),
    });
    const text = await res.text();
    return { ok: res.status < 400, text: `HTTP ${res.status}\n${text.slice(0, 500)}` };
  }

  return { ok: false, text: `Unknown tool: ${name}` };
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
  if (!process.env.DRIP_API_KEY || !process.env.DRIP_ACCOUNT_ID) {
    yield { kind: "error", error: "Missing DRIP_API_KEY or DRIP_ACCOUNT_ID" };
    return;
  }

  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
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

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        tools: TOOLS,
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

        const result = await callDripTool(tc.function.name, parsedArgs);

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
  }
}
