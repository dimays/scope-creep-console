import { useState } from "react";
import { Form, Link, redirect } from "react-router";
import { InProgress } from "~/components/state";
import { ThreadReply } from "~/components/thread-reply";
import {
  parseMeta,
  type ThreadInitiator,
  type ThreadMessage,
  type ThreadStatus,
  threadTitle,
} from "~/lib/threads";
import { addMessage, branchThread, getThread } from "~/lib/threads.server";
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
  const thread = await getThread(Number(params.id));
  if (!thread) throw new Response("Not found", { status: 404 });
  return thread;
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.id);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "reply");

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
  const { thread, messages, parent, branches } = loaderData;
  const status = thread.status as ThreadStatus;
  const orgInitiated = (thread.initiator as ThreadInitiator) === "org";
  const lastMessageId = messages.at(-1)?.id ?? null;

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
        <span className={`tag thread-status--${status}`}>{TURN[status] ?? status}</span>
      </header>

      <div className="thread">
        {messages.map((msg) => {
          if (msg.type === "outcome") return <OutcomeCard key={msg.id} msg={msg} />;
          if (msg.type === "generated-request")
            return <GeneratedRequestCard key={msg.id} msg={msg} />;
          if (msg.type === "branch") return <BranchCard key={msg.id} msg={msg} />;
          return (
            <div key={msg.id} className={`msg msg--${msg.role === "owner" ? "owner" : "agent"}`}>
              <span className="msg__author">{authorLabel(msg)}</span>
              <p className="msg__body">{msg.body}</p>
            </div>
          );
        })}
      </div>

      {status === "needs-you" ? (
        <p className="console__notice thread-needs-you">
          This thread is waiting on you{orgInitiated ? " — the Chief of Staff opened it" : ""}.
          Reply below to hand the turn back to the org.
        </p>
      ) : null}

      {status === "working" ? (
        <p className="console__notice thread-working">
          <InProgress label="The org is working on this thread…" />
        </p>
      ) : null}

      {status === "closed" ? (
        <p className="console__notice">
          This thread is closed. Reply to reopen it and hand the turn back to the org.
        </p>
      ) : null}

      <ThreadReply threadId={thread.id} status={status} />

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
