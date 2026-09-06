import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { agentDisplayName, listDocs, readLoop } from "~/lib/explore.server";
import type { Route } from "./+types/explore-loop";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.name} · Loop · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const loop = await readLoop(params.name);
  if (!loop) throw new Response("Not found", { status: 404 });
  // The loop's markdown lives in the docs graph under its own name (loop docs use
  // `name:` frontmatter that matches the registry entry) — link to it when present.
  const docs = await listDocs();
  const docSlug = docs.some((d) => d.slug === loop.name) ? loop.name : null;
  return {
    loop,
    ownerDisplay: loop.ownerAgent ? agentDisplayName(loop.ownerAgent) : null,
    docSlug,
  };
}

export default function ExploreLoop({ loaderData }: Route.ComponentProps) {
  const { loop, ownerDisplay, docSlug } = loaderData;
  const eyebrow = [loop.kind, loop.status, loop.mode].filter(Boolean).join(" · ");
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">{eyebrow}</p>
          <h1 className="console__title">{loop.name}</h1>
        </div>
        <Link to="/explore/loops" className="console__meta">
          ← loops
        </Link>
      </header>
      <ExploreNav />
      {loop.description && <p className="doc-path">{loop.description}</p>}

      <section className="doc-group">
        <h2 className="doc-group__title">Owner</h2>
        {loop.ownerAgent && ownerDisplay ? (
          <ul className="console__list">
            <li className="doc-row">
              <Link to={`/explore/agents/${loop.ownerAgent}`} className="console__item-name">
                {ownerDisplay}
              </Link>
              <span className="console__tag">owner_agent</span>
            </li>
          </ul>
        ) : (
          <p className="console__empty">No owning agent recorded.</p>
        )}
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Definition</h2>
        {docSlug ? (
          <ul className="console__list">
            <li className="doc-row">
              <Link to={`/explore/docs/${docSlug}`} className="console__item-name">
                Read the loop
              </Link>
              {loop.path && <span className="console__tag">{loop.path}</span>}
            </li>
          </ul>
        ) : (
          <p className="console__empty">
            {loop.path ? `Defined at ${loop.path}.` : "No definition path recorded."}
          </p>
        )}
      </section>
    </main>
  );
}
