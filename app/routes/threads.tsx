import { Form, Link, redirect } from "react-router";
import { getOrCreateConversation } from "~/lib/conversation.server";
import type { ThreadStatus } from "~/lib/threads";
import { createThread, listThreads } from "~/lib/threads.server";
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
  // Make sure the live agent-chat thread always exists so it shows in the list.
  await getOrCreateConversation("chat", "Console chat");
  return { threads: await listThreads() };
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
  const { threads } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Threads</h1>
        </div>
        <p className="console__meta">one conversation with your Chief of Staff · work-029</p>
      </header>

      <Form method="post" className="req-form">
        <input name="title" className="req-input" placeholder="Start a thread — a title" required />
        <textarea
          name="body"
          className="req-textarea"
          placeholder="Ask, tell, or request. The org triages it — declines, refines, routes, or tickets — and every outcome stays a proposal you approve."
          required
        />
        <div className="req-actions">
          <button type="submit" className="req-submit">
            Open thread
          </button>
        </div>
      </Form>

      <section className="doc-group">
        <h2 className="doc-group__title">All threads</h2>
        {threads.length === 0 ? (
          <p className="console__empty">No threads yet.</p>
        ) : (
          <ul className="console__list">
            {threads.map((t) => {
              const status = t.status as ThreadStatus;
              return (
                <li key={t.id} className="doc-row">
                  <Link to={`/threads/${t.id}`} className="console__item-name">
                    {t.title || (t.kind === "chat" ? "Console chat" : "Untitled thread")}
                  </Link>
                  <span className="thread-row__meta">
                    <span className="tag">{t.kind}</span>
                    <span className={`tag thread-status--${status}`}>{TURN[status] ?? status}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
