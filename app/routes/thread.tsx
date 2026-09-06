import { Link } from "react-router";
import { InProgress } from "~/components/state";
import { ThreadReply } from "~/components/thread-reply";
import {
  parseMeta,
  type ThreadInitiator,
  type ThreadMessage,
  type ThreadStatus,
} from "~/lib/threads";
import { addMessage, getThread } from "~/lib/threads.server";
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
  const form = await request.formData();
  const body = String(form.get("body") ?? "")
    .trim()
    .slice(0, 5000);
  if (!body) return { ok: false };
  // Owner replies by default; an async operator/org reply can pass author/status.
  const author = String(form.get("author") ?? "owner").slice(0, 40) || "owner";
  const role = author === "owner" ? "owner" : "agent";
  const statusRaw = form.get("status");
  const status = statusRaw ? (String(statusRaw) as ThreadStatus) : undefined;
  await addMessage(Number(params.id), role, body, {
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
  const { thread, messages } = loaderData;
  const status = thread.status as ThreadStatus;
  const orgInitiated = (thread.initiator as ThreadInitiator) === "org";

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
          <h1 className="console__title">{thread.title || "Untitled thread"}</h1>
        </div>
        <span className={`tag thread-status--${status}`}>{TURN[status] ?? status}</span>
      </header>

      <div className="thread">
        {messages.map((msg) =>
          msg.type === "outcome" ? (
            <OutcomeCard key={msg.id} msg={msg} />
          ) : (
            <div key={msg.id} className={`msg msg--${msg.role === "owner" ? "owner" : "agent"}`}>
              <span className="msg__author">{authorLabel(msg)}</span>
              <p className="msg__body">{msg.body}</p>
            </div>
          ),
        )}
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
    </main>
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
