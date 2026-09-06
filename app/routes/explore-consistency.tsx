import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { consistency } from "~/lib/explore.server";
import { inputConsistency } from "~/lib/human-input.server";
import type { Route } from "./+types/explore-consistency";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Consistency · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { report: await consistency(), inputChecks: await inputConsistency() };
}

/** Deterministic UTC (avoids SSR/client hydration mismatch), matching /work/inputs. */
function fmt(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

type Item = { key: string; label: string; to?: string };

export default function Consistency({ loaderData }: Route.ComponentProps) {
  const { report, inputChecks } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">What's out of sync</p>
          <h1 className="console__title">Consistency</h1>
        </div>
      </header>
      <ExploreNav />

      {report.ok && inputChecks.ok && (
        <p className="console__notice">Everything checks out — nothing out of sync.</p>
      )}

      {/* Human-Input Log self-checks (work-022): does the record match reality? */}
      {!inputChecks.hasData && (
        <p className="console__notice console__notice--error">
          Human-input consistency: no inputs and no control-plane commits to compare — can't verify
          (this is not the same as "clean").
        </p>
      )}
      <Section
        title="Input gaps (control-plane work with no captured input)"
        hint="Commits/merges that no recorded human input accounts for — a missed input or an uninstalled/misfiring capture hook."
        empty="Every observed commit is preceded by a captured input."
        items={inputChecks.gaps.map((gap, i) => ({
          key: `gap-${gap.fromTs}-${i}`,
          label: `${gap.count} commit(s) with no preceding input — ${fmt(gap.fromTs)} to ${fmt(gap.toTs)} (e.g. "${gap.commits[0]}")`,
        }))}
      />
      <Section
        title="Duplicate inputs"
        hint="The same input recorded twice — a duplicate id, or a duplicate (timestamp, text) pair (e.g. a backfill overlapping a live capture)."
        empty="No duplicate inputs."
        items={inputChecks.dups.map((dup, i) => ({
          key: `dup-${dup.kind}-${i}`,
          label:
            dup.kind === "id"
              ? `duplicate id "${dup.key}" — ${dup.count}×`
              : `duplicate (ts, text) — ${dup.count}× (ids: ${dup.ids.join(", ")})`,
        }))}
      />

      <Section
        title="Version skew (version.ts ↔ package.json ↔ CHANGELOG)"
        hint="These must agree — /healthz reads version.ts, so a lag makes it report a stale version."
        empty="Release version is in sync."
        items={report.versionSkew.map((v) => ({
          key: v.source,
          label: `${v.source}: ${v.version}`,
        }))}
      />
      <Section
        title="Registries not yet generated"
        hint="Still hand-seeded. Building the harvester will generate these from manifests."
        empty="All registries are generated."
        items={report.ungeneratedRegistries.map((file) => ({ key: file, label: file }))}
      />
      <Section
        title="Proposed (unratified) docs"
        hint="Specs/decisions still in the proposed state."
        empty="No proposed docs pending."
        items={report.proposedDocs.map((doc) => ({
          key: doc.slug,
          label: doc.title,
          to: `/explore/docs/${doc.slug}`,
        }))}
      />
      <Section
        title="Dangling wikilinks"
        hint="A link to a doc that doesn't exist yet — sometimes intentional (a marker for future work)."
        empty="Every wikilink resolves."
        items={report.danglingLinks.map((link, i) => ({
          key: `${link.from}-${link.target}-${i}`,
          label: `[[${link.target}]] — referenced by ${link.from}`,
          to: `/explore/docs/${link.from}`,
        }))}
      />
      <Section
        title="Stale docs (last_verified > 30 days)"
        empty="No stale docs."
        items={report.staleDocs.map((doc) => ({
          key: doc.slug,
          label: `${doc.slug} (${doc.days}d)`,
          to: `/explore/docs/${doc.slug}`,
        }))}
      />
    </main>
  );
}

function Section({
  title,
  items,
  empty,
  hint,
}: {
  title: string;
  items: Item[];
  empty: string;
  hint?: string;
}) {
  return (
    <section className="doc-group">
      <div className="console__panel-head">
        <h2 className="doc-group__title">{title}</h2>
        <span className={items.length ? "console__count console__count--warn" : "console__count"}>
          {items.length}
        </span>
      </div>
      {hint && items.length > 0 && <p className="console__empty">{hint}</p>}
      {items.length === 0 ? (
        <p className="console__empty">{empty}</p>
      ) : (
        <ul className="console__list">
          {items.map((item) => (
            <li key={item.key} className="doc-row">
              {item.to ? (
                <Link to={item.to} className="console__item-name">
                  {item.label}
                </Link>
              ) : (
                <span className="console__item-name">{item.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
