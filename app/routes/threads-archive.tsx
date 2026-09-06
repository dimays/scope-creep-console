import { StatusDot } from "@scope-creep/design";
import { Form, Link, useNavigation } from "react-router";
import { SubmitButton } from "~/components/state";
import { type ThreadInitiator, type ThreadStatus, threadTitle } from "~/lib/threads";
import { listArchivedThreads, restoreThread } from "~/lib/threads.server";
import type { Route } from "./+types/threads-archive";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Archive · Scope Creep" }];
}

/** How a thread's lifecycle/turn reads to the Owner (mirrors the main Threads surface). */
const TURN: Record<ThreadStatus, string> = {
  "needs-you": "Your turn",
  working: "Org working",
  closed: "Closed",
  open: "Open",
};

export async function loader(_: Route.LoaderArgs) {
  return { threads: await listArchivedThreads() };
}

/**
 * Restore an archived thread (work-049) back to the main list. Reversible and low-stakes, so
 * — unlike archiving — it needs no confirm gate. Revalidation then drops it from this view.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "restore");
  if (intent === "restore") {
    const id = Number(form.get("id"));
    if (id) await restoreThread(id);
    return { ok: true };
  }
  return { ok: false };
}

export default function ThreadsArchive({ loaderData }: Route.ComponentProps) {
  const { threads } = loaderData;

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">
            <Link to="/threads" className="console__backlink">
              Threads
            </Link>{" "}
            · Archive
          </p>
          <h1 className="console__title">Archive</h1>
        </div>
        <p className="console__meta">
          archived threads · restore any one to return it to the main list
        </p>
      </header>

      <section className="doc-group">
        <h2 className="doc-group__title">
          Archived <span className="console__count">{threads.length}</span>
        </h2>
        {threads.length === 0 ? (
          <p className="console__empty">
            Nothing archived. Archive a thread from its page to tuck it away here — you can always
            restore it.
          </p>
        ) : (
          <ul className="console__list">
            {threads.map((t) => (
              <ArchivedRow key={t.id} thread={t} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ArchivedRow({
  thread,
}: {
  thread: Awaited<ReturnType<typeof listArchivedThreads>>[number];
}) {
  const status = thread.status as ThreadStatus;
  const turn = TURN[status] ?? status;
  const orgInitiated = (thread.initiator as ThreadInitiator) === "org";
  const nav = useNavigation();
  const restoring =
    nav.state !== "idle" &&
    nav.formData?.get("intent") === "restore" &&
    Number(nav.formData?.get("id")) === thread.id;

  return (
    <li className="thread-row thread-row--archived">
      <StatusDot status={status} label={turn} title={turn} className="thread-dot" />
      <Link to={`/threads/${thread.id}`} className="console__item-name thread-row__title">
        {threadTitle(thread)}
      </Link>
      {orgInitiated ? <span className="tag thread-row__initiator">CoS opened</span> : null}
      <span className="tag">{thread.kind}</span>
      <Form method="post" className="thread-row__restore">
        <input type="hidden" name="intent" value="restore" />
        <input type="hidden" name="id" value={thread.id} />
        <SubmitButton pending={restoring} pendingLabel="Restoring…" className="thread-restore-btn">
          Restore
        </SubmitButton>
      </Form>
    </li>
  );
}
