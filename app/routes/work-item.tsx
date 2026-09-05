import { Link } from "react-router";
import { readWorkItem } from "~/lib/work.server";
import type { Route } from "./+types/work-item";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.id} · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const result = await readWorkItem(params.id);
  if (!result) throw new Response("Not found", { status: 404 });
  return result;
}

export default function WorkItemRoute({ loaderData }: Route.ComponentProps) {
  const { item, html } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">
            {item.type} · {item.status} · {item.priority} priority
          </p>
          <h1 className="console__title">{item.title}</h1>
        </div>
        <Link to="/work" className="console__meta">
          ← board
        </Link>
      </header>
      <p className="doc-path">
        {item.id} · owner {item.owner} · updated {item.updated}
        {item.spec ? (
          <>
            {" · spec "}
            <Link to={`/explore/docs/${item.spec}`}>{item.spec}</Link>
          </>
        ) : null}
      </p>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, single-user control-plane markdown */}
      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
