import { StatusDot } from "@scope-creep/design";
import { Form, Link, redirect, useNavigation } from "react-router";
import { SubmitButton } from "~/components/state";
import { groupThreads, type Thread, type ThreadInitiator, type ThreadStatus } from "~/lib/threads";
import { createThread, listArchivedThreads, listThreads } from "~/lib/threads.server";
import type { Route } from "./+types/threads";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Threads · Scope Creep" }];
}

/** How a thread's lifecycle/turn reads to the Owner. */
const TURN: Record<ThreadStatus, string> = {
  "needs-you": "Your turn",
  working: "Org working",
  closed: "Closed",
  open: "Open",
};

export async function loader(_: Route.LoaderArgs) {
  // The main list excludes archived threads (work-049); we surface a count so the Archive
  // link only appears once there's something in it.
  const [threads, archived] = await Promise.all([listThreads(), listArchivedThreads()]);
  return { threads, archivedCount: archived.length };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const title = String(form.get("title") ?? "")
    .trim()
    .slice(0, 200);
  const body = String(form.get("body") ?? "")
    .trim()
    .slice(0, 5000);
  if (!title || !body) return { ok: false };
  const row = await createThread(title, body);
  return redirect(`/threads/${row.id}`);
}

export default function Threads({ loaderData }: Route.ComponentProps) {
  const { threads, archivedCount } = loaderData;
  const nav = useNavigation();
  const opening = nav.state !== "idle" && nav.formMethod === "POST";
  // One derivation, shared with the home badge: threads parked on the Owner surface first.
  const { needsYou, active, closed } = groupThreads(threads);

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Threads</h1>
        </div>
        <div className="threads-header-meta">
          <p className="console__meta">Conversations with your Chief of Staff</p>
          <Link to="/threads/archive" className="threads-archive-link">
            Archive{archivedCount > 0 ? ` (${archivedCount})` : ""} →
          </Link>
        </div>
      </header>

      <Form method="post" className="req-form">
        <input
          name="title"
          className="req-input"
          placeholder="Start a thread — a title"
          disabled={opening}
          required
        />
        <textarea
          name="body"
          className="req-textarea"
          placeholder="Ask, tell, or request. The org triages it — declines, refines, routes, or tickets — and every outcome stays a proposal you approve."
          disabled={opening}
          required
        />
        <div className="req-actions">
          <SubmitButton pending={opening} pendingLabel="Opening…">
            Open thread
          </SubmitButton>
        </div>
      </Form>

      {threads.length === 0 ? (
        <section className="doc-group">
          <h2 className="doc-group__title">All threads</h2>
          <p className="console__empty">No threads yet — start one above.</p>
        </section>
      ) : (
        <>
          {/* The "needs-you" queue (work-030): threads parked on you, distinct from working/closed. */}
          <ThreadSection
            title="Waiting on you"
            count={needsYou.length}
            threads={needsYou}
            emphasis
            empty="Nothing is waiting on you right now."
          />
          <ThreadSection title="Active" count={active.length} threads={active} />
          {closed.length > 0 ? (
            <ThreadSection title="Closed" count={closed.length} threads={closed} />
          ) : null}
        </>
      )}
    </main>
  );
}

function ThreadSection({
  title,
  count,
  threads,
  emphasis = false,
  empty,
}: {
  title: string;
  count: number;
  threads: Thread[];
  emphasis?: boolean;
  empty?: string;
}) {
  return (
    <section className={emphasis ? "doc-group thread-queue" : "doc-group"}>
      <h2 className="doc-group__title">
        {title} <span className="console__count">{count}</span>
      </h2>
      {threads.length === 0 ? (
        empty ? (
          <p className="console__empty">{empty}</p>
        ) : null
      ) : (
        <ul className="console__list">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  const status = thread.status as ThreadStatus;
  const turn = TURN[status] ?? status;
  const orgInitiated = (thread.initiator as ThreadInitiator) === "org";
  return (
    <li className="thread-row">
      {/* A single status dot — orange means the thread is waiting on you. The
          StatusDot primitive carries the accessible name; we keep the Owner-facing
          "turn" phrasing ("Your turn" / "Org working") as its label + tooltip. */}
      <StatusDot status={status} label={turn} title={turn} className="thread-dot" />
      <Link to={`/threads/${thread.id}`} className="console__item-name thread-row__title">
        {thread.title || "Untitled thread"}
      </Link>
      {/* The org started this one — the CoS opened it to get your input (work-030). */}
      {orgInitiated ? <span className="tag thread-row__initiator">CoS opened</span> : null}
      <span className="tag">{thread.kind}</span>
    </li>
  );
}
