import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { FeedbackMount } from "~/components/feedback-mount";
import { listRoadmap } from "~/lib/explore.server";
import type { Route } from "./+types/explore-roadmap";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Roadmap · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const all = await listRoadmap();
  return { latest: all[0] ?? null, history: all.slice(1) };
}

export default function ExploreRoadmap({ loaderData }: Route.ComponentProps) {
  const { latest, history } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Roadmap</h1>
        </div>
        <Link to="/explore" className="console__meta">
          ← explore
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">The CEO's latest board presentation, and the history beneath it.</p>

      {latest === null ? (
        <p className="console__empty">
          No roadmap presentation recorded yet. When the roadmap loop produces one in{" "}
          <code>roadmap/</code>, the latest deck appears here — nothing is invented.
        </p>
      ) : (
        <>
          <section className="console__panel roadmap-latest">
            <div className="console__panel-head">
              <h2 className="console__panel-title">Latest presentation</h2>
              {latest.date && <span className="console__meta">{latest.date}</span>}
            </div>
            <Link to={`/explore/docs/${latest.slug}`} className="console__item-name">
              {latest.title}
            </Link>
            {latest.description && <p className="console__empty">{latest.description}</p>}
            <p className="console__meta" style={{ marginTop: "0.5rem" }}>
              <Link to={`/explore/docs/${latest.slug}`}>Read the full deck →</Link>
            </p>
          </section>

          <section className="doc-group" style={{ marginTop: "1.5rem" }}>
            <div className="console__panel-head">
              <h2 className="doc-group__title">History</h2>
              <span className="console__count">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <p className="console__empty">
                No prior presentations — this is the founding roadmap. The supersession trail will
                build here as the roadmap loop runs.
              </p>
            ) : (
              <ul className="console__list">
                {history.map((r) => (
                  <li key={r.slug} className="doc-row">
                    <Link to={`/explore/docs/${r.slug}`} className="console__item-name">
                      {r.title}
                    </Link>
                    {r.date && <span className="console__meta">{r.date}</span>}
                    {r.description && <p className="console__empty">{r.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <FeedbackMount
        contextKey="console/explore/roadmap"
        question="Does the roadmap reflect where you want the org to go?"
      />
    </main>
  );
}
