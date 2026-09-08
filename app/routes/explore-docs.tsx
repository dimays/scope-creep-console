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
      <p className="doc-path">
        Charter, standards, ADRs, product specs, and loops — grouped and collapsed. Open a section
        to browse it.
      </p>
      {groups.map((group) => (
        <details key={group.group} className="doc-section">
          <summary className="doc-section__summary">
            <span className="doc-section__chevron" aria-hidden="true">
              ▶
            </span>
            <span className="doc-section__name">{group.group}</span>
            <span className="console__count">{group.docs.length}</span>
          </summary>
          <div className="doc-section__body">
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
          </div>
        </details>
      ))}
    </main>
  );
}
