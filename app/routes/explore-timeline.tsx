import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { listLedger } from "~/lib/explore.server";
import type { Route } from "./+types/explore-timeline";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Timeline · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { entries: await listLedger() };
}

export default function Timeline({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Timeline</h1>
        </div>
        <p className="console__meta">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </p>
      </header>
      <ExploreNav />
      {entries.length === 0 ? (
        <p className="console__empty">
          No ledger entries yet — consequential actions append here as they happen.
        </p>
      ) : (
        <ol className="timeline">
          {entries.map((entry) => (
            <li key={entry.slug} className="timeline__item">
              <span className="timeline__order">{String(entry.order).padStart(3, "0")}</span>
              <Link to={`/explore/docs/${entry.docSlug}`} className="timeline__title">
                {entry.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
