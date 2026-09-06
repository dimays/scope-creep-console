import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { agentDisplayName, listLoops } from "~/lib/explore.server";
import type { Route } from "./+types/explore-loops";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loops · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const loops = await listLoops();
  return {
    loops: loops.map((l) => ({
      ...l,
      ownerDisplay: l.ownerAgent ? agentDisplayName(l.ownerAgent) : null,
    })),
  };
}

export default function ExploreLoops({ loaderData }: Route.ComponentProps) {
  const { loops } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Loops</h1>
        </div>
        <Link to="/explore" className="console__meta">
          ← explore
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">The governed, repeatable procedures the org runs.</p>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">All loops</h2>
          <span className="console__count">{loops.length}</span>
        </div>
        {loops.length === 0 ? (
          <p className="console__empty">
            No loops registered yet. When <code>registry/loops.json</code> lists loops, they appear
            here.
          </p>
        ) : (
          <ul className="console__list">
            {loops.map((loop) => (
              <li key={loop.name} className="doc-row">
                <Link to={`/explore/loops/${loop.name}`} className="console__item-name">
                  {loop.name}
                </Link>
                {loop.ownerAgent && loop.ownerDisplay && (
                  <Link to={`/explore/agents/${loop.ownerAgent}`} className="console__meta">
                    {loop.ownerDisplay}
                  </Link>
                )}
                {loop.status && <span className="console__tag">{loop.status}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
