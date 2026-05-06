import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { dripExtras } from "./drip-extras";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = resolve(__dirname, "drip-mcp-bootstrap.mjs");

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
2. Upsert the lead into Drip via the drip_create_subscriber tool, including:
   - email
   - custom_fields: { first_name, last_name, company, role, ai_subject, ai_body }
   - tags: ["TEST-PLAY-A"]   (apply the tag in this same call — do NOT use drip_tag_subscriber)
3. Enroll the subscriber into the test campaign via drip_subscribe_to_campaign,
   using the campaign_id supplied in the user message. The campaign is
   configured with double opt-in, so the recipient will get a confirmation
   email first, then the real campaign email after they click confirm.
4. Track an event "agent_enrolled" via drip_track_event with action="agent_enrolled".

Then output a final JSON block (and nothing else after it) with the fields:
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

export async function* runAgent(
  lead: Lead,
  campaignId: string,
): AsyncGenerator<AgentEvent, void, void> {
  const userMessage = `Lead JSON:
\`\`\`json
${JSON.stringify(lead, null, 2)}
\`\`\`

Drip campaign_id to enroll into: ${campaignId}

Run the full flow now.`;

  const result = query({
    prompt: userMessage,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: "claude-sonnet-4-6",
      maxTurns: 12,
      mcpServers: {
        drip: {
          type: "stdio",
          command: process.execPath,
          args: [BOOTSTRAP],
          env: {
            DRIP_API_KEY: process.env.DRIP_API_KEY ?? "",
            DRIP_ACCOUNT_ID: process.env.DRIP_ACCOUNT_ID ?? "",
            PATH: process.env.PATH ?? "",
          },
        },
        akdrip: dripExtras,
      },
      allowedTools: [
        "mcp__drip__drip_create_subscriber",
        "mcp__drip__drip_subscribe_to_campaign",
        "mcp__drip__drip_track_event",
        "mcp__drip__drip_list_campaigns",
      ],
    },
  });

  let finalText = "";
  try {
    for await (const msg of result) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            const text = block.text.trim();
            if (text) {
              finalText = text;
              yield { kind: "thinking", text };
            }
          } else if (block.type === "tool_use") {
            yield {
              kind: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input,
            };
          }
        }
      } else if (msg.type === "user") {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if ((block as any).type === "tool_result") {
              const tr = block as any;
              const raw = Array.isArray(tr.content)
                ? tr.content.map((c: any) => c.text ?? "").join("")
                : String(tr.content ?? "");
              yield {
                kind: "tool_result",
                toolUseId: tr.tool_use_id ?? "",
                ok: !tr.is_error,
                preview: raw.slice(0, 600),
              };
            }
          }
        }
      } else if (msg.type === "result") {
        if (msg.subtype === "success") {
          yield { kind: "final", text: msg.result ?? finalText };
        } else {
          yield { kind: "error", error: `Run ended: ${msg.subtype}` };
        }
      }
    }
  } catch (err) {
    yield { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
