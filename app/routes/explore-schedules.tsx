import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { describeCron, readRoutines } from "~/lib/explore.server";
import type { Route } from "./+types/explore-schedules";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Schedules · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const { routines, manageAllUrl } = await readRoutines();
  return {
    manageAllUrl,
    routines: routines.map((r) => ({
      ...r,
      cronText: describeCron(r.cron),
    })),
  };
}

export default function ExploreSchedules({ loaderData }: Route.ComponentProps) {
  const { routines, manageAllUrl } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Schedules</h1>
        </div>
        <Link to="/" className="console__meta">
          ← overview
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">
        The loops that run on a cadence — scheduled cloud routines that clone the repo and open PRs.
        The cron is the <em>floor</em>; each fire self-gates to the loop's self-tuned cadence.
        Enable, disable, and run-now happen in claude.ai, never here.
      </p>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Scheduled routines</h2>
          <span className="console__count">{routines.length}</span>
        </div>
        {routines.length === 0 ? (
          <p className="console__empty">
            No scheduled routines recorded. When one is created in claude.ai and noted in{" "}
            <code>registry/routines.json</code>, it appears here.
          </p>
        ) : (
          <section className="console__grid">
            {routines.map((r) => (
              <article key={r.triggerId} className="console__panel schedule-card">
                <div className="console__panel-head">
                  <h3 className="console__panel-title">
                    <Link to={`/explore/loops/${r.loop}`} className="console__item-name">
                      {r.name}
                    </Link>
                  </h3>
                  {r.status && (
                    <span className={`status-pill status-pill--${r.status}`}>{r.status}</span>
                  )}
                </div>
                <dl className="schedule-card__meta">
                  <dt>Cadence</dt>
                  <dd>{r.cronText}</dd>
                  {r.cadenceBoundsDays && (
                    <>
                      <dt>Self-tunes</dt>
                      <dd>
                        {r.cadenceBoundsDays[0]}–{r.cadenceBoundsDays[1]} days
                      </dd>
                    </>
                  )}
                  {r.model && (
                    <>
                      <dt>Model</dt>
                      <dd className="schedule-card__model">{r.model}</dd>
                    </>
                  )}
                </dl>
                <a
                  href={r.manageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="schedule-card__manage"
                >
                  Manage in claude.ai ↗
                </a>
              </article>
            ))}
          </section>
        )}
      </section>

      <p className="console__meta" style={{ marginTop: "1rem" }}>
        <a href={manageAllUrl} target="_blank" rel="noreferrer">
          Manage all routines in claude.ai ↗
        </a>{" "}
        · Event-driven loops (dev-cycle, heal, …) have no cadence — see{" "}
        <Link to="/explore/loops">Loops</Link>.
      </p>
    </main>
  );
}
