import { Link } from "react-router";
import { db, ensureSchema } from "~/db";
import { pageVisits } from "~/db/schema";
import { readRegistry } from "~/lib/registry.server";
import type { ThreadStatus } from "~/lib/threads";
import { listThreads } from "~/lib/threads.server";
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
  // Threads card: newest-updated first, with "waiting on you" surfaced to the top.
  const all = await listThreads();
  const threads = all
    .map((t) => ({ id: t.id, title: t.title, status: t.status as ThreadStatus }))
    .sort((a, b) => Number(b.status === "needs-you") - Number(a.status === "needs-you"))
    .slice(0, 5);
  const needsYou = all.filter((t) => t.status === "needs-you").length;
  return {
    registry,
    visitCount: visits.length,
    version: APP_VERSION,
    threads,
    threadCount: all.length,
    needsYou,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { registry, visitCount, version, threads, threadCount, needsYou } = loaderData;

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
        <Panel title="Threads" count={threadCount}>
          <Link to="/threads" className="console__panel-link">
            {needsYou > 0 ? `${needsYou} waiting on you →` : "Open Threads →"}
          </Link>
          {threads.length === 0 ? (
            <p className="console__empty">No threads yet.</p>
          ) : (
            <ul className="console__list">
              {threads.map((t) => (
                <li key={t.id} className="console__item">
                  <span className={`thread-dot thread-dot--${t.status}`} aria-hidden="true" />
                  <Link to={`/threads/${t.id}`} className="console__item-name">
                    {t.title || "Untitled thread"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Agents" count={registry.agents.length}>
          <ul className="console__list">
            {registry.agents.map((agent) => (
              <li key={agent.name} className="console__item">
                <Link to={`/explore/agents/${agent.name}`} className="console__item-name">
                  {agent.name}
                </Link>
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
                  <RegistryName name={app.name} repo={app.repo} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Extensions" count={registry.extensions.length}>
          {registry.extensions.length === 0 ? (
            <p className="console__empty">None installed yet.</p>
          ) : (
            <ul className="console__list">
              {registry.extensions.map((ext, i) => (
                <li key={ext.name ?? i} className="console__item">
                  <RegistryName name={ext.name} repo={ext.repo} />
                  {ext.kind && <span className="console__tag">{ext.kind}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </main>
  );
}

// Apps/extensions live in their own repos, so their entries link out to the repo
// (its README is the doc). Non-URL repo values (e.g. "pending-remote") render as text.
function RegistryName({ name, repo }: { name?: string; repo?: string }) {
  const label = name ?? "unnamed";
  if (repo?.startsWith("http")) {
    return (
      <a href={repo} target="_blank" rel="noreferrer" className="console__item-name">
        {label} ↗
      </a>
    );
  }
  return <span className="console__item-name">{label}</span>;
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
