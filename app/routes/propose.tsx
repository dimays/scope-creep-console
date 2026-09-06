import { useState } from "react";
import { diffStat, type FileDiff, parseUnifiedDiff } from "~/lib/diff";
import { effectiveChatModel } from "~/lib/models.server";
import type { Route } from "./+types/propose";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Propose a change · Scope Creep" }];
}

/**
 * The flagship surface (work-017): describe a change in natural language, watch the
 * agent draft real `{path, content}` edits, review them as a diff rendered in-app —
 * all in an isolated worktree (ADR-009) — then approve to open a gated PR (work-016).
 * The merge itself stays the Owner's gated step; this page never merges.
 */
export async function loader(_: Route.LoaderArgs) {
  return {
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    model: await effectiveChatModel(),
  };
}

type ProposeResponse = {
  ok: boolean;
  title?: string;
  summary?: string;
  edits?: { path: string; content: string }[];
  text?: string;
  diff?: string;
  liveClean?: boolean;
  reason?: string;
  error?: string;
};

type Phase = "idle" | "proposing" | "proposed" | "landing" | "landed" | "error";

export default function Propose({ loaderData }: Route.ComponentProps) {
  const { hasKey, model } = loaderData;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ProposeResponse | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  async function propose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = text.trim();
    if (!body || phase === "proposing" || phase === "landing") return;
    setPhase("proposing");
    setResult(null);
    setNote(null);
    setPrUrl(null);
    try {
      const res = await fetch("/chat/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const data = (await res.json()) as ProposeResponse;
      setResult(data);
      if (data.ok) {
        setPhase("proposed");
      } else {
        setPhase("error");
        setNote(explain(data));
      }
    } catch {
      setPhase("error");
      setNote("Couldn't reach the proposal runtime. Try again.");
    }
  }

  async function approve() {
    if (!result?.ok || !result.edits) return;
    setPhase("landing");
    setNote(null);
    try {
      const res = await fetch("/chat/land", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          edits: result.edits,
          title: result.title,
          body: result.summary,
        }),
      });
      const data = (await res.json()) as { ok: boolean; prUrl?: string; error?: string };
      if (data.ok && data.prUrl) {
        setPhase("landed");
        setPrUrl(data.prUrl);
      } else {
        setPhase("proposed");
        setNote(`Couldn't open a PR: ${data.error ?? "unknown error"}`);
      }
    } catch {
      setPhase("proposed");
      setNote("Couldn't reach the merge flow. Try again.");
    }
  }

  function discard() {
    setResult(null);
    setPhase("idle");
    setNote(null);
    setPrUrl(null);
  }

  const busy = phase === "proposing" || phase === "landing";

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep · work-017</p>
          <h1 className="console__title">Propose a change</h1>
        </div>
        <p className="console__meta">
          {model} · edits are isolated (ADR-009); merge stays gated (work-016)
        </p>
      </header>

      {!hasKey ? (
        <p className="console__notice console__notice--error">
          No <code>ANTHROPIC_API_KEY</code> is configured, so the agent can't draft edits yet. Set
          the key to enable agent-generated proposals.
        </p>
      ) : null}

      <form className="req-form" onSubmit={propose}>
        <textarea
          className="req-textarea"
          placeholder="Describe a change to this app — e.g. “Add a footer link to the Threads page” or “Rename the Console header to Mission Control”."
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          disabled={busy}
          required
        />
        <div className="req-actions">
          <button type="submit" className="req-submit" disabled={busy || !hasKey}>
            {phase === "proposing" ? "Drafting the proposal…" : "Propose"}
          </button>
        </div>
      </form>

      {note ? <p className="console__notice console__notice--error">{note}</p> : null}

      {phase === "landed" && prUrl ? (
        <section className="propose-result">
          <p className="console__notice">
            A gated PR is open. Review and merge it yourself — the merge stays your gated step.
            <br />
            <a href={prUrl} target="_blank" rel="noreferrer" className="console__panel-link">
              {prUrl} ↗
            </a>
          </p>
          <div className="req-actions">
            <button type="button" className="req-submit" onClick={discard}>
              Propose another
            </button>
          </div>
        </section>
      ) : null}

      {result?.ok && phase !== "landed" ? (
        <ProposalCard
          title={result.title ?? "Proposed change"}
          summary={result.summary ?? ""}
          diff={result.diff ?? ""}
          liveClean={result.liveClean ?? false}
          onApprove={approve}
          onDiscard={discard}
          landing={phase === "landing"}
        />
      ) : null}
    </main>
  );
}

function explain(data: ProposeResponse): string {
  switch (data.reason) {
    case "no_key":
      return "No ANTHROPIC_API_KEY configured — set it to enable proposals.";
    case "no_proposal":
      return data.text
        ? `The agent answered without proposing an edit: ${data.text}`
        : "The agent didn't propose an edit. Try rephrasing the change.";
    case "max_steps":
      return "The agent explored the repo but didn't converge on an edit. Try a more specific request.";
    case "unsafe":
      return `The proposal was rejected by the path-safety gate: ${data.error ?? "unsafe path"}.`;
    case "preview_failed":
      return `The isolated preview failed: ${data.error ?? "unknown error"}.`;
    default:
      return data.error ?? data.text ?? "The proposal couldn't be produced.";
  }
}

function ProposalCard({
  title,
  summary,
  diff,
  liveClean,
  onApprove,
  onDiscard,
  landing,
}: {
  title: string;
  summary: string;
  diff: string;
  liveClean: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  landing: boolean;
}) {
  const files = parseUnifiedDiff(diff);
  const stat = diffStat(files);
  return (
    <section className="propose-result console__panel">
      <div className="console__panel-head">
        <h2 className="console__panel-title">{title}</h2>
        <span className="console__count">
          {stat.files} file{stat.files === 1 ? "" : "s"}
        </span>
      </div>
      {summary ? <p className="propose-summary">{summary}</p> : null}
      <p className="propose-stat">
        <span className="propose-stat__add">+{stat.additions}</span>{" "}
        <span className="propose-stat__del">−{stat.deletions}</span>
        {" · "}
        <span
          className={liveClean ? "propose-isolated" : "propose-isolated propose-isolated--warn"}
        >
          {liveClean
            ? "isolated — the running app was not touched"
            : "warning: the live working tree changed"}
        </span>
      </p>

      <DiffView files={files} />

      <div className="req-actions">
        <button type="button" className="req-submit" onClick={onApprove} disabled={landing}>
          {landing ? "Opening a gated PR…" : "Approve → open gated PR"}
        </button>
        <button
          type="button"
          className="req-submit propose-discard"
          onClick={onDiscard}
          disabled={landing}
        >
          Discard
        </button>
      </div>
    </section>
  );
}

function DiffView({ files }: { files: FileDiff[] }) {
  if (files.length === 0) {
    return <p className="console__empty">No textual diff (new empty files, perhaps).</p>;
  }
  return (
    <div className="diff">
      {files.map((f) => (
        <div key={f.path} className="diff__file">
          <div className="diff__file-head">
            <span className={`diff__status diff__status--${f.status}`}>{f.status}</span>
            <code className="diff__path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</code>
          </div>
          <pre className="diff__body">
            {f.lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and static
              <span key={i} className={`diff__line diff__line--${line.kind}`}>
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
