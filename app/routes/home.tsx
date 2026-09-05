import { db, ensureSchema } from "~/db";
import { pageVisits } from "~/db/schema";
import { readRegistry } from "~/lib/registry.server";
import { APP_VERSION } from "~/lib/version";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Scope Creep Console" },
    { name: "description", content: "The front door to your software factory." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await ensureSchema();
  await db.insert(pageVisits).values({ path: new URL(request.url).pathname, at: Date.now() });
  const visits = await db.select().from(pageVisits);
  const registry = await readRegistry();
  return { registry, visitCount: visits.length, version: APP_VERSION };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { registry, visitCount, version } = loaderData;

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Console</h1>
        </div>
        <p className="console__meta">
          v{version} · {visitCount} visit{visitCount === 1 ? "" : "s"}
        </p>
      </header>

      {!registry.available && (
        <p className="console__notice">
          Control plane not found at <code>{registry.home}</code>. Set <code>SCOPE_CREEP_HOME</code>{" "}
          to its path to see your factory.
        </p>
      )}

      <section className="console__grid">
        <Panel title="Agents" count={registry.agents.length}>
          <ul className="console__list">
            {registry.agents.map((agent) => (
              <li key={agent.name} className="console__item">
                <span className="console__item-name">{agent.name}</span>
                {agent.kind && <span className="console__tag">{agent.kind}</span>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Apps" count={registry.apps.length}>
          {registry.apps.length === 0 ? (
            <p className="console__empty">No apps registered yet.</p>
          ) : (
            <ul className="console__list">
              {registry.apps.map((app, i) => (
                <li key={app.name ?? i} className="console__item">
                  <span className="console__item-name">{app.name ?? "unnamed"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Extensions" count={registry.extensions.length}>
          <p className="console__empty">None installed yet.</p>
        </Panel>
      </section>
    </main>
  );
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <article className="console__panel">
      <div className="console__panel-head">
        <h2 className="console__panel-title">{title}</h2>
        <span className="console__count">{count}</span>
      </div>
      {children}
    </article>
  );
}
