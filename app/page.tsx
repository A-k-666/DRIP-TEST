"use client";

import { useState, useRef, useEffect, useMemo } from "react";

type Evt =
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: any }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; preview: string }
  | { kind: "final"; text: string }
  | { kind: "error"; error: string };

type StepKey = "email" | "subscriber" | "campaign" | "event";
type Status = "pending" | "running" | "done" | "error";

const STEPS: { key: StepKey; label: string; icon: string }[] = [
  { key: "email", label: "Writing email", icon: "✍️" },
  { key: "subscriber", label: "Adding subscriber", icon: "👤" },
  { key: "campaign", label: "Enrolling in campaign", icon: "📧" },
  { key: "event", label: "Tracking event", icon: "📊" },
];

const FRIENDLY: Record<string, string> = {
  mcp__drip__drip_create_subscriber: "Add subscriber",
  mcp__drip__drip_subscribe_to_campaign: "Enroll in campaign",
  mcp__drip__drip_track_event: "Track event",
  mcp__drip__drip_list_campaigns: "List campaigns",
  ToolSearch: "Load tools",
};

const HIDE_FROM_LOG = new Set(["ToolSearch"]);

const SAMPLE = {
  email: "21106042.ayush.kargutkar@gmail.com",
  first_name: "Ayush",
  last_name: "Kargutkar",
  company: "FSZT Partners",
  role: "Founder",
  context:
    "Building AI agents that integrate with email automation tools like Drip.",
};

export default function Home() {
  const [lead, setLead] = useState(SAMPLE);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<Evt[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const logEndRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const derived = useMemo(() => derive(events), [events]);

  useEffect(() => {
    if (showLog) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, showLog]);

  const sawEmail = useRef(false);
  useEffect(() => {
    if (derived.email && !sawEmail.current) {
      sawEmail.current = true;
      setTimeout(
        () => emailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        80,
      );
    }
    if (!derived.email) sawEmail.current = false;
  }, [derived.email]);

  const sawResult = useRef(false);
  useEffect(() => {
    if (derived.result && !sawResult.current) {
      sawResult.current = true;
      setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        80,
      );
    }
    if (!derived.result) sawResult.current = false;
  }, [derived.result]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [running]);

  function set<K extends keyof typeof lead>(k: K, v: string) {
    setLead((s) => ({ ...s, [k]: v }));
  }

  async function run() {
    setEvents([]);
    setRunning(true);
    setStartedAt(Date.now());
    setEndedAt(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        setEvents((e) => [...e, { kind: "error", error: `HTTP ${res.status} ${text}` }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (chunk.startsWith("data: ")) {
            try {
              const evt = JSON.parse(chunk.slice(6)) as Evt;
              setEvents((e) => [...e, evt]);
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
    } catch (err) {
      setEvents((e) => [
        ...e,
        { kind: "error", error: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setRunning(false);
      setEndedAt(Date.now());
    }
  }

  const elapsed = startedAt ? ((endedAt ?? Date.now()) - startedAt) / 1000 : 0;
  const status = statusText(running, events, elapsed);

  return (
    <main>
      <h1>AK-DRIP Agent</h1>
      <p className="sub">
        Drop a lead → agent writes a personalized email → pushes into Drip campaign.
      </p>

      <div className="grid">
        <section className="card">
          <h2>Lead</h2>
          <label>Email</label>
          <input
            value={lead.email}
            onChange={(e) => set("email", e.target.value)}
            disabled={running}
          />
          <label>First name</label>
          <input
            value={lead.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            disabled={running}
          />
          <label>Last name</label>
          <input
            value={lead.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            disabled={running}
          />
          <label>Company</label>
          <input
            value={lead.company}
            onChange={(e) => set("company", e.target.value)}
            disabled={running}
          />
          <label>Role</label>
          <input
            value={lead.role}
            onChange={(e) => set("role", e.target.value)}
            disabled={running}
          />
          <label>Context</label>
          <textarea
            value={lead.context}
            onChange={(e) => set("context", e.target.value)}
            disabled={running}
          />
          <button onClick={run} disabled={running || !lead.email}>
            {running ? "Running…" : "Run Agent"}
          </button>
        </section>

        <section className="card output">
          <div className="status-bar">
            <h2>Live output</h2>
            <span className={`status-pill status-${status.tone}`}>{status.text}</span>
          </div>

          {events.length === 0 && (
            <div className="empty">
              Press <strong>Run Agent</strong> — progress shows up here in real time.
            </div>
          )}

          {events.length > 0 && (
            <>
              <div className="pipeline">
                {STEPS.map((s) => (
                  <Step
                    key={s.key}
                    icon={s.icon}
                    label={s.label}
                    status={derived.steps[s.key]}
                  />
                ))}
              </div>

              {derived.email && (
                <div className="email-card" ref={emailRef}>
                  <div className="card-tag">📨 Generated email</div>
                  <div className="email-subject">{derived.email.subject}</div>
                  <div className="email-rule" />
                  <pre className="email-body">{derived.email.body}</pre>
                </div>
              )}

              {derived.result && (
                <div className="result-card" ref={resultRef}>
                  <div className="card-tag good">✅ Pushed to Drip</div>
                  <Row label="Subscriber" value={derived.result.subscriberId} mono />
                  <Row label="Tag" value={derived.result.tag} mono />
                  <Row label="Campaign" value={derived.result.campaignId} mono />
                  <Row label="Event" value={derived.result.event} mono />
                </div>
              )}

              <button
                className="log-toggle"
                onClick={() => setShowLog((s) => !s)}
                disabled={false}
                style={{ marginTop: 14 }}
              >
                {showLog ? "▾" : "▸"} Activity log ({visibleLogCount(events)})
              </button>

              {showLog && (
                <div className="log">
                  {events.map((e, i) => (
                    <LogRow key={i} evt={e} />
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Step({ icon, label, status }: { icon: string; label: string; status: Status }) {
  return (
    <div className={`step step-${status}`}>
      <span className="step-icon">{icon}</span>
      <span className="step-label">{label}</span>
      <span className="step-state">
        {status === "running" && <span className="spinner" />}
        {status === "done" && "✓"}
        {status === "error" && "✕"}
        {status === "pending" && "·"}
      </span>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="result-row">
      <span className="result-key">{label}</span>
      <code className={mono ? "mono" : ""}>{value}</code>
    </div>
  );
}

function LogRow({ evt }: { evt: Evt }) {
  if (evt.kind === "thinking") {
    const text = evt.text.length > 240 ? evt.text.slice(0, 240) + "…" : evt.text;
    return <div className="log-row log-thinking">💭 {text}</div>;
  }
  if (evt.kind === "tool_use") {
    if (HIDE_FROM_LOG.has(evt.name)) return null;
    const friendly = FRIENDLY[evt.name] ?? evt.name;
    return (
      <div className="log-row log-tool">
        🔧 <strong>{friendly}</strong>
      </div>
    );
  }
  if (evt.kind === "tool_result") {
    const preview = evt.preview.length > 160 ? evt.preview.slice(0, 160) + "…" : evt.preview;
    return (
      <div className={`log-row ${evt.ok ? "log-ok" : "log-err"}`}>
        {evt.ok ? "✓" : "✕"} {preview}
      </div>
    );
  }
  if (evt.kind === "error") {
    return <div className="log-row log-err">✕ {evt.error}</div>;
  }
  return null;
}

// ── helpers ───────────────────────────────────────────────

function derive(events: Evt[]) {
  const idToName = new Map<string, string>();
  for (const e of events) {
    if (e.kind === "tool_use") idToName.set(e.id, e.name);
  }

  const toolStatus = new Map<string, Status>();
  for (const e of events) {
    if (e.kind === "tool_use") {
      toolStatus.set(e.name, "running");
    } else if (e.kind === "tool_result") {
      const name = idToName.get(e.toolUseId);
      if (name) toolStatus.set(name, e.ok ? "done" : "error");
    }
  }

  const createCall = events.find(
    (e) => e.kind === "tool_use" && e.name === "mcp__drip__drip_create_subscriber",
  ) as Extract<Evt, { kind: "tool_use" }> | undefined;

  const cf = createCall?.input?.custom_fields;
  const email =
    cf?.ai_subject && cf?.ai_body ? { subject: cf.ai_subject, body: cf.ai_body } : null;

  let stepEmail: Status = "pending";
  if (events.some((e) => e.kind === "thinking")) stepEmail = "running";
  if (email) stepEmail = "done";

  const stepSubscriber = toolStatus.get("mcp__drip__drip_create_subscriber") ?? "pending";
  const stepCampaign = toolStatus.get("mcp__drip__drip_subscribe_to_campaign") ?? "pending";
  const stepEvent = toolStatus.get("mcp__drip__drip_track_event") ?? "pending";

  let subscriberId: string | null = null;
  for (const e of events) {
    if (
      e.kind === "tool_result" &&
      idToName.get(e.toolUseId) === "mcp__drip__drip_create_subscriber" &&
      e.ok
    ) {
      const m = e.preview.match(/"id":\s*"([^"]+)"/);
      if (m) subscriberId = m[1];
    }
  }

  const tag = createCall?.input?.tags?.[0] ?? null;

  const campaignCall = events.find(
    (e) => e.kind === "tool_use" && e.name === "mcp__drip__drip_subscribe_to_campaign",
  ) as Extract<Evt, { kind: "tool_use" }> | undefined;
  const campaignId = campaignCall?.input?.campaign_id ?? null;

  const eventCall = events.find(
    (e) => e.kind === "tool_use" && e.name === "mcp__drip__drip_track_event",
  ) as Extract<Evt, { kind: "tool_use" }> | undefined;
  const eventAction = eventCall?.input?.action ?? null;

  const result =
    stepSubscriber === "done"
      ? {
          subscriberId,
          tag,
          campaignId: stepCampaign === "done" ? campaignId : null,
          event: stepEvent === "done" ? eventAction : null,
        }
      : null;

  return {
    steps: {
      email: stepEmail,
      subscriber: stepSubscriber,
      campaign: stepCampaign,
      event: stepEvent,
    } as Record<StepKey, Status>,
    email,
    result,
  };
}

function statusText(running: boolean, events: Evt[], elapsed: number) {
  if (running) return { text: `Running… ${elapsed.toFixed(1)}s`, tone: "run" };
  if (events.length === 0) return { text: "Idle", tone: "idle" };
  const hasErr = events.some((e) => e.kind === "error");
  if (hasErr) return { text: `Failed in ${elapsed.toFixed(1)}s`, tone: "err" };
  return { text: `Done in ${elapsed.toFixed(1)}s`, tone: "ok" };
}

function visibleLogCount(events: Evt[]) {
  return events.filter((e) => !(e.kind === "tool_use" && HIDE_FROM_LOG.has(e.name))).length;
}
