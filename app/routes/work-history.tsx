import { Link } from "react-router";
import { WorkNav } from "~/components/work-nav";
import { doneHistory } from "~/lib/work.server";
import type { Route } from "./+types/work-history";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Work History · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { items: await doneHistory() };
}

export default function WorkHistory({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Work History</h1>
        </div>
        <p className="console__meta">{items.length} shipped</p>
      </header>
      <WorkNav />
      {items.length === 0 ? (
        <p className="console__empty">Nothing shipped yet.</p>
      ) : (
        <ol className="history">
          {items.map((item) => (
            <li key={item.id} className="history__item">
              <div className="history__main">
                <Link to={`/work/${item.id}`} className="history__title">
                  {item.title}
                </Link>
                <div className="history__meta">
                  <span className={`tag tag--${item.type}`}>{item.type}</span>
                  <span className="history__owner">{item.owner}</span>
                  {item.pr && (
                    <a href={item.pr} target="_blank" rel="noreferrer" className="history__pr">
                      PR ↗
                    </a>
                  )}
                </div>
              </div>
              <span className="history__id">{item.id}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
