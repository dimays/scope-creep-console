import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, redirect, useNavigation, useRevalidator } from "react-router";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { SubmitButton } from "~/components/state";
import { ResumePanel, ThreadLauncher } from "~/components/thread-launcher";
import type { ProjectedTurn } from "~/lib/claude-sessions";
import { resolveThreadProjection } from "~/lib/claude-sessions.server";
import {
  parseMeta,
  type ThreadInitiator,
  type ThreadMessage,
  type ThreadStatus,
  threadTitle,
} from "~/lib/threads";
import {
  addMessage,
  archiveThread,
  branchThread,
  firstOwnerBody,
  getThread,
  launchThread,
  linkThreadSession,
} from "~/lib/threads.server";
import type { Route } from "./+types/thread";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Thread #${params.id} · Scope Creep` }];
}

const TURN: Record<ThreadStatus, string> = {
  "needs-you": "Your turn",
  working: "Org working",
  closed: "Closed",
  open: "Open",
};

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number(params.id);
  const thread = await getThread(id);
  if (!thread) throw new Response("Not found", { status: 404 });

  // The launcher + projected transcript (work-046/047, ADR-016) — reads local Claude Code
  // session data only, never calls Claude. The seed is the thread's first Owner message.
  const seed = await firstOwnerBody(id);
  const projection = await resolveThreadProjection(thread.thread, seed);
  // Persist a freshly-resolved correlation so later loads project straight from the path.
  if (projection.newlyResolved && projection.sessionUuid && projection.sessionPath) {
    await linkThreadSession(id, projection.sessionUuid, projection.sessionPath);
  }
  return { ...thread, projection };
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.id);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "reply");

  // Launch this thread into a Claude Code session (work-046). Records the seed message and
  // stamps the thread as launched; the redirect lands on the launched view, which fires the
  // deep link (or shows the copyable fallback). No Claude call happens here.
  if (intent === "launch") {
    const body = String(form.get("body") ?? "")
      .trim()
      .slice(0, 5000);
    if (!body) return { ok: false };
    await launchThread(id, body);
    return redirect(`/threads/${id}`);
  }

  // Archive this thread (work-049): stamp `archivedAt` so it leaves the main Threads UI, then
  // land on /threads (where it's now gone — it lives in the Archive view). Reversible via
  // Restore. Orthogonal to status; the confirm gate happens in-app before this POSTs.
  if (intent === "archive") {
    await archiveThread(id);
    return redirect("/threads");
  }

  // Branch a tangent into a linked child thread (work-032), then land on the child.
  if (intent === "branch") {
    const title = String(form.get("title") ?? "")
      .trim()
      .slice(0, 200);
    const body = String(form.get("body") ?? "")
      .trim()
      .slice(0, 5000);
    if (!title || !body) return { ok: false };
    const fromRaw = form.get("fromMessageId");
    const fromMessageId = fromRaw ? Number(fromRaw) || null : null;
    const child = await branchThread({ parentId: id, title, body, fromMessageId });
    return redirect(`/threads/${child.id}`);
  }

  const body = String(form.get("body") ?? "")
    .trim()
    .slice(0, 5000);
  if (!body) return { ok: false };
  // Owner replies by default; an async operator/org reply can pass author/status.
  const author = String(form.get("author") ?? "owner").slice(0, 40) || "owner";
  const role = author === "owner" ? "owner" : "agent";
  const statusRaw = form.get("status");
  const status = statusRaw ? (String(statusRaw) as ThreadStatus) : undefined;
  await addMessage(id, role, body, {
    status,
    meta: role === "owner" ? undefined : { author },
  });
  return { ok: true };
}

/** The visible author label for a timeline row. */
function authorLabel(msg: ThreadMessage): string {
  if (msg.role === "owner") return "you";
  return parseMeta(msg.meta).author ?? "org";
}

export default function Thread({ loaderData }: Route.ComponentProps) {
  const { thread, messages, parent, branches, projection } = loaderData;
  const status = thread.status as ThreadStatus;
  const orgInitiated = (thread.initiator as ThreadInitiator) === "org";
  const lastMessageId = messages.at(-1)?.id ?? null;
  const nav = useNavigation();
  const launching = nav.state !== "idle" && nav.formData?.get("intent") === "launch";
  const launched = projection.status !== "not-launched";
  const seed = messages.find((m) => m.role === "owner" && m.type === "message")?.body ?? "";

  // Bug-2 fix (ADR-013 decision-2): short-poll revalidation so a launched thread's projected
  // transcript, turn count, and status refresh on their own while the Claude Code session
  // streams new turns — no manual reload. It re-runs the loader, which re-reads the local
  // JSONL: still zero Claude calls (ADR-016). Polls ONLY while a launched thread isn't closed
  // (a closed thread is done — no needless polling), and stops on unmount. A ref holds the
  // latest revalidator so the interval survives state flips without being torn down each tick.
  const shouldPoll = launched && status !== "closed";
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;
  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(() => {
      const r = revalidatorRef.current;
      if (r.state === "idle") r.revalidate(); // don't stack requests
    }, 3000);
    return () => clearInterval(id);
  }, [shouldPoll]);

  // Nice-to-have: when new turns arrive (poll picked them up), auto-scroll to the newest so the
  // latest reply is visible in a long transcript (thread 7 has ~278 turns). Never scrolls on the
  // first render — only when the count grows — so opening a thread doesn't jump the viewport.
  const turnCount = projection.status === "matched" ? projection.turns.length : 0;
  const endRef = useRef<HTMLDivElement>(null);
  const prevTurnCount = useRef(turnCount);
  useEffect(() => {
    if (turnCount > prevTurnCount.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevTurnCount.current = turnCount;
  }, [turnCount]);

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">
            <Link to="/threads" className="console__backlink">
              Threads
            </Link>{" "}
            · {thread.kind}
            {orgInitiated ? " · CoS opened this" : null}
          </p>
          <h1 className="console__title">{threadTitle(thread)}</h1>
          {/* Branch backlink (work-032): the parent this thread was split from. */}
          {parent ? (
            <p className="thread-branchline">
              ↳ branched from{" "}
              <Link to={`/threads/${parent.id}`} className="console__backlink">
                {threadTitle(parent)}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="thread-header-actions">
          <span className={`tag thread-status--${status}`}>{TURN[status] ?? status}</span>
          <ArchiveThread />
        </div>
      </header>

      <div className="thread">
        {messages.map((msg) => {
          if (msg.type === "outcome") return <OutcomeCard key={msg.id} msg={msg} />;
          if (msg.type === "generated-request")
            return <GeneratedRequestCard key={msg.id} msg={msg} />;
          if (msg.type === "branch") return <BranchCard key={msg.id} msg={msg} />;
          // Once launched, plain messages are shown by the projected transcript below —
          // render only the typed cards here so the opener isn't duplicated.
          if (launched) return null;
          return (
            <div key={msg.id} className={`msg msg--${msg.role === "owner" ? "owner" : "agent"}`}>
              <span className="msg__author">{authorLabel(msg)}</span>
              <p className="msg__body">{msg.body}</p>
            </div>
          );
        })}
      </div>

      {/* The launcher (work-046) + projected transcript (work-047), replacing the old
          in-app chat runtime (ADR-016: the conversation lives in Claude Code, not here). */}
      {launched ? (
        <>
          <section className="doc-group thread-transcript">
            <h2 className="doc-group__title">
              Transcript{" "}
              <span className="console__count">
                {projection.status === "matched" ? projection.turns.length : "…"}
              </span>
            </h2>
            <p className="thread-transcript__src">
              Projected from the local Claude Code session — no Claude call.
            </p>
            {projection.status === "matched" ? (
              projection.turns.length > 0 ? (
                <>
                  <Transcript turns={projection.turns} />
                  {/* Auto-scroll target: the newest turn (see the turn-count effect above). */}
                  <div ref={endRef} aria-hidden="true" />
                </>
              ) : (
                <p className="console__empty">
                  The session exists but has no turns yet. Empty is empty.
                </p>
              )
            ) : (
              <p className="console__empty">
                Waiting for the Claude Code session to start — no transcript captured yet. It
                appears here automatically once the session's first message lands.
              </p>
            )}
          </section>

          <ResumePanel
            threadId={thread.id}
            deepLink={projection.deepLink}
            openRepoLink={projection.openRepoLink}
            cliCommand={projection.cliCommand}
            resumeCommand={projection.resumeCommand}
            schemeRegistered={projection.schemeRegistered}
            matched={projection.status === "matched"}
          />
        </>
      ) : (
        <ThreadLauncher seed={seed} launching={launching} />
      )}

      {/* Branches list (work-032): child threads split off this one — the forward link. */}
      {branches.length > 0 ? (
        <section className="doc-group thread-branches">
          <h2 className="doc-group__title">
            Branches <span className="console__count">{branches.length}</span>
          </h2>
          <ul className="console__list">
            {branches.map((b) => (
              <li key={b.id} className="thread-row">
                <span className="thread-dot thread-dot--branch" aria-hidden="true" />
                <Link to={`/threads/${b.id}`} className="console__item-name thread-row__title">
                  {threadTitle(b)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <BranchForm lastMessageId={lastMessageId} />
    </main>
  );
}

/**
 * The projected transcript (work-047): owner/agent prose and high-level tool activity,
 * mapped 1:1 from the local Claude Code session JSONL. Consecutive tool turns collapse into
 * one compact activity line so a long tool run reads as a single step, never invented prose.
 */
function Transcript({ turns }: { turns: ProjectedTurn[] }) {
  const rows: ReactNode[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role === "tool") {
      const tools: string[] = [];
      let j = i;
      while (j < turns.length && turns[j].role === "tool") {
        if (turns[j].tool) tools.push(turns[j].tool as string);
        j++;
      }
      rows.push(
        <div key={`tool-${i}`} className="transcript__tool">
          <span className="transcript__tool-label">tool activity</span>
          <span className="transcript__tool-list">{summarizeTools(tools)}</span>
        </div>,
      );
      i = j - 1;
      continue;
    }
    rows.push(
      <div key={`msg-${i}`} className={`msg msg--${t.role === "owner" ? "owner" : "agent"}`}>
        <span className="msg__author">{t.role === "owner" ? "you" : "chief-of-staff"}</span>
        <p className="msg__body">{t.text}</p>
      </div>,
    );
  }
  return <div className="thread thread--transcript">{rows}</div>;
}

/** "Read ×3, Bash, Edit ×2" — a compact, honest summary of a tool run. */
function summarizeTools(tools: string[]): string {
  const counts: Array<[string, number]> = [];
  for (const name of tools) {
    const last = counts.at(-1);
    if (last && last[0] === name) last[1]++;
    else counts.push([name, 1]);
  }
  return counts.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
}

/** Split a tangent into a linked child thread (work-032). */
function BranchForm({ lastMessageId }: { lastMessageId: number | null }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="thread-branch-toggle" onClick={() => setOpen(true)}>
        ↳ Branch a tangent
      </button>
    );
  }

  return (
    <Form method="post" className="req-form thread-branch-form">
      <input type="hidden" name="intent" value="branch" />
      {lastMessageId != null ? (
        <input type="hidden" name="fromMessageId" value={lastMessageId} />
      ) : null}
      <p className="thread-branch-form__hint">
        Branch a linked child thread from here. The parent keeps a card pointing to it.
      </p>
      <input name="title" className="req-input" placeholder="The tangent — a title" required />
      <textarea
        name="body"
        className="req-textarea"
        placeholder="What's the tangent? This opens a new, linked thread."
        required
      />
      <div className="req-actions">
        <button type="button" className="thread-branch-cancel" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="req-submit">
          Branch thread
        </button>
      </div>
    </Form>
  );
}

/**
 * Archive this thread (work-049): one clear button that opens a tasteful, focus-trapped
 * confirm gate (the Owner's one deliberate validation — never `window.confirm`). Confirming
 * POSTs the `archive` intent; the thread then leaves the main Threads UI and lives in the
 * Archive, restorable anytime.
 */
function ArchiveThread() {
  const [open, setOpen] = useState(false);
  const nav = useNavigation();
  const archiving = nav.state !== "idle" && nav.formData?.get("intent") === "archive";

  return (
    <>
      <button
        type="button"
        className="thread-archive-btn"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Archive thread
      </button>
      {open ? (
        <ConfirmDialog
          title="Archive this thread?"
          description="It moves to the Archive — you can restore it anytime."
          onCancel={() => setOpen(false)}
        >
          <Form method="post" className="modal__confirm-form">
            <input type="hidden" name="intent" value="archive" />
            <SubmitButton pending={archiving} pendingLabel="Archiving…">
              Archive
            </SubmitButton>
          </Form>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/** A typed intake-outcome card: a decision/action deep-linking to its artifact. */
function OutcomeCard({ msg }: { msg: ThreadMessage }) {
  const meta = parseMeta(msg.meta);
  return (
    <div className="outcome-card">
      <span className="outcome-card__badge">Outcome</span>
      <div className="outcome-card__body">
        <p className="outcome-card__label">{meta.label ?? "Outcome"}</p>
        {msg.body ? <p className="outcome-card__desc">{msg.body}</p> : null}
        {meta.refUrl ? (
          <Link to={meta.refUrl} className="outcome-card__link">
            View →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A generated feature request (work-032) — the org distilled a request from the thread and
 * created a ticket/PRD. Rendered as a first-class card linking to that artifact.
 */
function GeneratedRequestCard({ msg }: { msg: ThreadMessage }) {
  const meta = parseMeta(msg.meta);
  return (
    <div className="outcome-card outcome-card--genreq">
      <span className="outcome-card__badge">Feature request</span>
      <div className="outcome-card__body">
        <p className="outcome-card__label">{meta.label ?? "Generated feature request"}</p>
        {msg.body ? <p className="outcome-card__desc">{msg.body}</p> : null}
        {meta.refUrl ? (
          <Link to={meta.refUrl} className="outcome-card__link">
            {meta.refLabel ? `${meta.refLabel} →` : "View the created ticket →"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** An in-parent marker (work-032) pointing to a child thread branched from this point. */
function BranchCard({ msg }: { msg: ThreadMessage }) {
  const meta = parseMeta(msg.meta);
  const to = meta.refUrl ?? (meta.childThreadId ? `/threads/${meta.childThreadId}` : null);
  return (
    <div className="outcome-card outcome-card--branch">
      <span className="outcome-card__badge">Branched</span>
      <div className="outcome-card__body">
        <p className="outcome-card__label">{meta.childThreadTitle ?? meta.label ?? "Branch"}</p>
        {to ? (
          <Link to={to} className="outcome-card__link">
            Open the branched thread →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
