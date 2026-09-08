import { useState } from "react";
import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { FeedbackMount } from "~/components/feedback-mount";
import { listReleases, releasePackage, releaseTier } from "~/lib/explore.server";
import type { Route } from "./+types/explore-releases";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Releases · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const releases = (await listReleases()).map((r) => ({
    slug: r.slug,
    title: r.title,
    description: r.description,
    date: r.date,
    version: r.version,
    tier: releaseTier(r.version),
    pkg: releasePackage(r.scope),
  }));
  return { releases };
}

type ReleaseView = Awaited<ReturnType<typeof loader>>["releases"][number];

export default function ExploreReleases({ loaderData }: Route.ComponentProps) {
  const { releases } = loaderData;
  const [grouped, setGrouped] = useState(true);

  // "By package" groups under each package (newest package first — the list is already
  // newest-first, so first-seen order holds); "Chronological" is the flat stream.
  const groups = new Map<string, { label: string; items: ReleaseView[] }>();
  for (const r of releases) {
    const g = groups.get(r.pkg.key) ?? { label: r.pkg.label, items: [] };
    g.items.push(r);
    groups.set(r.pkg.key, g);
  }

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
        What the org has shipped — each release notes the package it covers and its semver. Open one
        for the full notes.
      </p>

      <div className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">All releases</h2>
          <div className="seg-toggle" role="tablist" aria-label="Group releases">
            <button
              type="button"
              role="tab"
              aria-selected={grouped}
              className={grouped ? "seg-toggle__btn seg-toggle__btn--active" : "seg-toggle__btn"}
              onClick={() => setGrouped(true)}
            >
              By package
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!grouped}
              className={!grouped ? "seg-toggle__btn seg-toggle__btn--active" : "seg-toggle__btn"}
              onClick={() => setGrouped(false)}
            >
              Chronological
            </button>
          </div>
        </div>

        {releases.length === 0 ? (
          <p className="console__empty">
            No releases recorded yet. When the control plane's <code>releases/</code> set has an
            entry, it appears here — nothing is invented.
          </p>
        ) : grouped ? (
          [...groups.values()].map((group) => (
            <section key={group.label} className="release-package">
              <div className="release-package__head">
                <h3 className="release-package__name">{group.label}</h3>
                <span className="console__count">{group.items.length}</span>
              </div>
              <div className="release-list">
                {group.items.map((r) => (
                  <ReleaseCard key={r.slug} release={r} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="release-list">
            {releases.map((r) => (
              <ReleaseCard key={r.slug} release={r} showPackage />
            ))}
          </div>
        )}
      </div>
      <FeedbackMount
        contextKey="console/explore/releases"
        question="Anything surprising in these releases?"
      />
    </main>
  );
}

function ReleaseCard({ release, showPackage }: { release: ReleaseView; showPackage?: boolean }) {
  const { title, description, date, version, tier, pkg } = release;
  return (
    <article className="release-card">
      <div className="release-card__head">
        <Link to={`/explore/docs/${release.slug}`} className="release-card__title">
          {title}
        </Link>
        {version && (
          <span className={`release-ver release-ver--${tier ?? "patch"}`}>
            v{version}
            {tier && <span className="release-ver__tier">{tier}</span>}
          </span>
        )}
      </div>
      <div className="release-card__meta">
        {showPackage && <span className="release-pkg">{pkg.label}</span>}
        {date && <span className="release-card__date">{date}</span>}
      </div>
      {description && <p className="release-card__desc">{description}</p>}
    </article>
  );
}
