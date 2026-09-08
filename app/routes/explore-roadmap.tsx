import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { FeedbackMount } from "~/components/feedback-mount";
import { agentDisplayName } from "~/lib/display-name";
import {
  listReleases,
  listRoadmap,
  readReleaseNow,
  readRoadmapDeck,
  releaseTier,
} from "~/lib/explore.server";
import type { Route } from "./+types/explore-roadmap";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Roadmap · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const [all, releases, deckRes, releaseNow] = await Promise.all([
    listRoadmap(),
    listReleases(),
    readRoadmapDeck(),
    readReleaseNow(),
  ]);
  const shipped = releases
    .filter((r) => r.version)
    .map((r) => ({ slug: r.slug, version: r.version as string, tier: releaseTier(r.version) }));
  // The current release's codename (the parenthetical in its H1, e.g. "Autonomous
  // governance") + what it delivered and the gap it carries forward — the "Now" content.
  const current = releases[0] ?? null;
  const codename = current ? /\(([^)]+)\)\s*$/.exec(current.title)?.[1] : undefined;
  return {
    latest: all[0] ?? null,
    history: all.slice(1),
    themes: deckRes?.deck.themes ?? [],
    horizon: deckRes?.deck.horizon ?? null,
    disposition: deckRes?.deck.disposition ?? null,
    shipped,
    currentVersion: shipped[0]?.version ?? null,
    codename: codename ?? null,
    milestone: releaseNow?.milestone ?? current?.description ?? null,
    knownGap: releaseNow?.residual ?? null,
    currentReleaseSlug: current?.slug ?? null,
  };
}

export default function ExploreRoadmap({ loaderData }: Route.ComponentProps) {
  const {
    latest,
    history,
    themes,
    horizon,
    disposition,
    shipped,
    currentVersion,
    codename,
    milestone,
    knownGap,
    currentReleaseSlug,
  } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Roadmap</h1>
        </div>
        <Link to="/" className="console__meta">
          ← overview
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">
        Where the org has been, where it is, and where it's headed — the CEO's current board
        presentation, with the history beneath it.
      </p>

      {latest !== null && (
        <section className="roadmap-strip" aria-label="Roadmap at a glance">
          <div className="roadmap-stage">
            <p className="roadmap-stage__label">Shipped</p>
            {shipped.length === 0 ? (
              <p className="roadmap-stage__empty">No releases yet.</p>
            ) : (
              <div className="roadmap-chips">
                {shipped.map((r) => (
                  <Link
                    key={r.slug}
                    to={`/explore/docs/${r.slug}`}
                    className={`roadmap-chip roadmap-chip--${r.tier ?? "patch"}`}
                  >
                    v{r.version}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <span className="roadmap-strip__arrow" aria-hidden="true">
            →
          </span>

          <div className="roadmap-stage roadmap-stage--now">
            <p className="roadmap-stage__label">Now</p>
            <p className="roadmap-stage__now-version">
              {currentVersion ? `v${currentVersion}` : "—"}
            </p>
            {codename && <p className="roadmap-stage__codename">{codename}</p>}
            <p className="roadmap-stage__sub">
              {latest.date ? `as of ${latest.date}` : "current deck"}
              {disposition && (
                <span className={`roadmap-disp roadmap-disp--${disposition.toLowerCase()}`}>
                  {disposition}
                </span>
              )}
            </p>
            {milestone && (
              <div className="roadmap-now-block">
                <p className="roadmap-now-block__label">Delivered</p>
                <p className="roadmap-now-block__text">{milestone}</p>
              </div>
            )}
            {knownGap && (
              <div className="roadmap-now-block">
                <p className="roadmap-now-block__label roadmap-now-block__label--gap">Known gap</p>
                <p className="roadmap-now-block__text">{knownGap}</p>
              </div>
            )}
            {currentReleaseSlug && (
              <Link to={`/explore/docs/${currentReleaseSlug}`} className="roadmap-now-block__link">
                Release notes →
              </Link>
            )}
          </div>

          <span className="roadmap-strip__arrow" aria-hidden="true">
            →
          </span>

          <div className="roadmap-stage">
            <p className="roadmap-stage__label">
              Headed{horizon ? <span className="roadmap-stage__horizon"> · {horizon}</span> : null}
            </p>
            {themes.length === 0 ? (
              <p className="roadmap-stage__empty">
                <Link to={`/explore/docs/${latest.slug}`}>See the deck →</Link>
              </p>
            ) : (
              <ol className="roadmap-themes">
                {themes.map((t) => (
                  <li key={t.title} className="roadmap-theme">
                    <span className="roadmap-theme__title">{t.title}</span>
                    {t.owners.length > 0 && (
                      <span className="roadmap-theme__owner">{agentDisplayName(t.owners[0])}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}

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
