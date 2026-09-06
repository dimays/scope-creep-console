import { Link } from "react-router";
import { Blocked, InProgress } from "~/components/state";
import { WorkNav } from "~/components/work-nav";
import { board } from "~/lib/work.server";
import type { Route } from "./+types/work";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Work · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { columns: await board() };
}

export default function Work({ loaderData }: Route.ComponentProps) {
  const { columns } = loaderData;
  const total = columns.reduce((n, col) => n + col.items.length, 0);
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Work</h1>
        </div>
        <p className="console__meta">{total} items · from the control plane</p>
      </header>
      <WorkNav />
      <div className="board">
        {columns.map((col) => (
          <section key={col.status} className="board__col">
            <div className="board__col-head">
              <h2 className="board__col-title">{col.label}</h2>
              <span className="console__count">{col.items.length}</span>
            </div>
            {col.items.length === 0 ? (
              <p className="board__empty">—</p>
            ) : (
              col.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/work/${item.id}`}
                  className={`card card--${item.priority}`}
                >
                  <p className="card__title">{item.title}</p>
                  {item.status === "active" ? (
                    <InProgress label="In progress" className="card__state" />
                  ) : null}
                  {item.status === "blocked" ? (
                    <Blocked label="Blocked" className="card__state" />
                  ) : null}
                  <div className="card__meta">
                    <span className={`tag tag--${item.type}`}>{item.type}</span>
                    <span className="card__owner">{item.owner}</span>
                  </div>
                </Link>
              ))
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
