import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { readAgent } from "~/lib/explore.server";
import type { Route } from "./+types/explore-agent";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.name} · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const agent = await readAgent(params.name);
  if (!agent) throw new Response("Not found", { status: 404 });
  return agent;
}

export default function ExploreAgent({ loaderData }: Route.ComponentProps) {
  const agent = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Agent{agent.status ? ` · ${agent.status}` : ""}</p>
          <h1 className="console__title">{agent.displayName}</h1>
        </div>
        <Link to="/" className="console__meta">
          ← dashboard
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">{agent.description}</p>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Contributions</h2>
          <span className="console__count">{agent.contributions.length}</span>
        </div>
        {agent.contributions.length === 0 ? (
          <p className="console__empty">No ledger entries reference this agent yet.</p>
        ) : (
          <ul className="console__list">
            {agent.contributions.map((entry) => (
              <li key={entry.slug} className="doc-row">
                <Link to="/explore/timeline" className="console__item-name">
                  {entry.title}
                </Link>
                <span className="console__tag">#{String(entry.order).padStart(3, "0")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Loops owned</h2>
          <span className="console__count">{agent.loopsOwned.length}</span>
        </div>
        {agent.loopsOwned.length === 0 ? (
          <p className="console__empty">This agent owns no loops.</p>
        ) : (
          <ul className="console__list">
            {agent.loopsOwned.map((loop) => (
              <li key={loop.name} className="doc-row">
                <Link to={`/explore/loops/${loop.name}`} className="console__item-name">
                  {loop.name}
                </Link>
                {loop.status && <span className="console__tag">{loop.status}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Charter</h2>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, single-user control-plane markdown */}
        <article className="prose" dangerouslySetInnerHTML={{ __html: agent.charterHtml }} />
      </section>
    </main>
  );
}
