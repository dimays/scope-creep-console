import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { type DocRecord, listDocs } from "~/lib/explore.server";
import type { Route } from "./+types/explore-docs";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Docs · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const docs = await listDocs();
  const groups: Array<{ group: string; docs: DocRecord[] }> = [];
  for (const doc of docs) {
    let bucket = groups.find((g) => g.group === doc.group);
    if (!bucket) {
      bucket = { group: doc.group, docs: [] };
      groups.push(bucket);
    }
    bucket.docs.push(doc);
  }
  return { groups };
}

export default function ExploreDocs({ loaderData }: Route.ComponentProps) {
  const { groups } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Docs</h1>
        </div>
      </header>
      <ExploreNav />
      {groups.map((group) => (
        <section key={group.group} className="doc-group">
          <h2 className="doc-group__title">{group.group}</h2>
          <ul className="console__list">
            {group.docs.map((doc) => (
              <li key={doc.slug} className="doc-row">
                <Link to={`/explore/docs/${doc.slug}`} className="console__item-name">
                  {doc.title}
                </Link>
                {doc.status && <span className="console__tag">{doc.status}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
