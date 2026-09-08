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
              <p className="empty-state__title">No activity captured yet</p>
              <span className="empty-state__badge">Awaiting core · work-036</span>
            </div>
            <p className="empty-state__body">
              This surface projects a structured activity log (<code>activity/*.ndjson</code> in the
              control plane). Nothing writes that log yet: the capture hook that emits delegations,
              spin-ups, and confers is an <strong>unbuilt feature in core scope-creep</strong> (
              <code>work-036</code>, delegation-event-capture) — not a console bug. Once it lands
              and the org runs, entries appear here automatically.
            </p>
            <p className="empty-state__body">
              In the meantime, the org's recorded decisions and events live on the{" "}
              <Link to="/explore/timeline">Timeline</Link> (the ledger).
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
