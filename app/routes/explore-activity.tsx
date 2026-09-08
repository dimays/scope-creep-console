import { ActivityRow } from "@scope-creep/design";
import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { activityHref, activityVerb, agentDisplayName, listActivity } from "~/lib/explore.server";
import type { Route } from "./+types/explore-activity";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Activity · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const events = await listActivity();
  return {
    events: events.map((e) => ({
      ...e,
      actorDisplay: agentDisplayName(e.actor),
      verb: activityVerb(e.type),
      href: activityHref(e),
    })),
  };
}

export default function ExploreActivity({ loaderData }: Route.ComponentProps) {
  const { events } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Activity</h1>
        </div>
        <Link to="/" className="console__meta">
          ← overview
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">
        Who broke off, decided, spun up, and staffed what — the org working, projected read-only
        from the structured activity log. Decisions link to the ledger; nothing is inferred.
      </p>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Org activity</h2>
          <span className="console__count">{events.length}</span>
        </div>
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__head">
              <p className="empty-state__title">No activity to show here</p>
              <span className="empty-state__badge empty-state__badge--muted">
                Local log · work-036
              </span>
            </div>
            <p className="empty-state__body">
              The capture hook <em>is</em> built and shipping (<code>work-036</code>, done): a{" "}
              <code>PreToolUse: Task</code> hook appends each spawn/delegation to{" "}
              <code>activity/YYYY-MM.ndjson</code>. But that log is intentionally{" "}
              <strong>local and gitignored</strong> — it mirrors <code>human-input/</code> and is
              never pushed — so it only has entries where the org has actually delegated. A fresh
              clone, a different machine, or a deployed console reading a clone all show nothing
              here.
            </p>
            <p className="empty-state__body">
              So this is expected on a quiet workspace — but it also means the surface can never
              populate for a console that isn't the one where delegations ran. That transport gap is
              being triaged separately. In the meantime, the org's recorded decisions and events
              live on the <Link to="/explore/timeline">Timeline</Link> (the ledger).
            </p>
          </div>
        ) : (
          <div className="activity-feed">
            {events.map((e) => (
              <ActivityRow
                key={e.id ?? `${e.actor}-${e.ts}-${e.summary}`}
                className="activity-row"
                actor={
                  <Link to={`/explore/agents/${e.actor}`} className="console__item-name">
                    {e.actorDisplay}
                  </Link>
                }
                time={e.ts ?? undefined}
                href={e.href ?? undefined}
              >
                <span className="activity-row__verb">{e.verb}</span> {e.summary}
              </ActivityRow>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
