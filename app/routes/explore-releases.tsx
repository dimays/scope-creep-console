import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { FeedbackMount } from "~/components/feedback-mount";
import { listReleases } from "~/lib/explore.server";
import type { Route } from "./+types/explore-releases";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Releases · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { releases: await listReleases() };
}

export default function ExploreReleases({ loaderData }: Route.ComponentProps) {
  const { releases } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Releases</h1>
        </div>
        <Link to="/" className="console__meta">
          ← overview
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">
        What the org has shipped — newest first. Open one for the full notes.
      </p>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">All releases</h2>
          <span className="console__count">{releases.length}</span>
        </div>
        {releases.length === 0 ? (
          <p className="console__empty">
            No releases recorded yet. When the control plane's <code>releases/</code> set has an
            entry, it appears here — nothing is invented.
          </p>
        ) : (
          <ul className="console__list">
            {releases.map((r) => (
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
      <FeedbackMount
        contextKey="console/explore/releases"
        question="Anything surprising in these releases?"
      />
    </main>
  );
}
