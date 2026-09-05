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
        <p className="console__meta">{entries.length} entries</p>
      </header>
      <ExploreNav />
      <ol className="timeline">
        {entries.map((entry) => (
          <li key={entry.slug} className="timeline__item">
            <span className="timeline__order">{String(entry.order).padStart(3, "0")}</span>
            <span className="timeline__title">{entry.title}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
