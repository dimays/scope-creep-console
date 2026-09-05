import { ExploreNav } from "~/components/explore-nav";
import { readDoc } from "~/lib/explore.server";
import type { Route } from "./+types/explore-doc";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.slug} · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const result = await readDoc(params.slug);
  if (!result) throw new Response("Not found", { status: 404 });
  return result;
}

export default function ExploreDoc({ loaderData }: Route.ComponentProps) {
  const { doc, html } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">{doc.group}</p>
          <h1 className="console__title">{doc.title}</h1>
        </div>
      </header>
      <ExploreNav />
      <p className="doc-path">
        <code>{doc.path}</code>
      </p>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, single-user control-plane markdown */}
      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
