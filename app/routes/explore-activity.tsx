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
        <Link to="/explore" className="console__meta">
          ← explore
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
          <p className="console__empty">
            No activity captured yet. Delegations, spin-ups, and confers appear here once the
            capture hook (<code>work-036</code>) is wired and the org runs — the log is local and
            starts empty on a fresh clone.
          </p>
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
