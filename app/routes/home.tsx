import { StatusDot } from "@scope-creep/design";
import { Link } from "react-router";
import { db, ensureSchema } from "~/db";
import { pageVisits } from "~/db/schema";
import { agentDisplayName } from "~/lib/display-name";
import { readOrg } from "~/lib/org.server";
import { readRegistry } from "~/lib/registry.server";
import { needsYouThreads, type ThreadStatus } from "~/lib/threads";
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
  // We still record the visit (telemetry stays in the ledger of pageVisits) but no longer
  // surface a running count in the header — on a single-user console it's vanity, not signal.
  await db.insert(pageVisits).values({ path: new URL(request.url).pathname, at: Date.now() });
  const registry = await readRegistry();
  // Org summary for the Agents panel: execs with their employee headcount (ADR-017).
  const org = await readOrg();
  const orgSummary = {
    execCount: org.tree.execs.length,
    employeeCount: org.employeeCount,
    templateCount: org.templates.length,
    execs: org.tree.execs
      .map((e) => ({ name: e.name, reports: e.employees.length }))
      .sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name)),
  };
  // Threads card: newest-updated first, with "waiting on you" surfaced to the top.
  const all = await listThreads();
  const threads = all
    .map((t) => ({ id: t.id, title: t.title, status: t.status as ThreadStatus }))
    .sort((a, b) => Number(b.status === "needs-you") - Number(a.status === "needs-you"))
    .slice(0, 5);
  const needsYou = needsYouThreads(all).length;
  return {
    registry,
    orgSummary,
    version: APP_VERSION,
    threads,
    threadCount: all.length,
    needsYou,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { registry, orgSummary, version, threads, threadCount, needsYou } = loaderData;

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Console</h1>
        </div>
        <p className="console__meta">v{version}</p>
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
                  <StatusDot status={t.status} className="thread-dot" />
                  <Link to={`/threads/${t.id}`} className="console__item-name">
                    {t.title || "Untitled thread"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Agents" count={registry.agents.length}>
          <Link to="/explore/agents" className="console__panel-link">
            {orgSummary.employeeCount > 0
              ? `Org — ${orgSummary.employeeCount} employee${orgSummary.employeeCount === 1 ? "" : "s"} across ${orgSummary.execCount} execs →`
              : "Open the org →"}
          </Link>
          {orgSummary.execs.length === 0 ? (
            <p className="console__empty">No agents registered yet.</p>
          ) : (
            <ul className="console__list">
              {orgSummary.execs.map((exec) => (
                <li key={exec.name} className="console__item">
                  <Link to={`/explore/agents/${exec.name}`} className="console__item-name">
                    {agentDisplayName(exec.name)}
                  </Link>
                  {/* One consistent report indicator on every row — including "0 reports" —
                      so the column reads as a clean, aligned count rather than a ragged mix. */}
                  <span className="console__tag console__tag--count">
                    {exec.reports} report{exec.reports === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {orgSummary.templateCount > 0 && (
            <Link to="/explore/templates" className="console__panel-link">
              {orgSummary.templateCount} employee template
              {orgSummary.templateCount === 1 ? "" : "s"} →
            </Link>
          )}
        </Panel>

        {/* Apps and extensions share one card (both live in their own repos and link out).
            Kept as two labeled sub-lists so a near-empty Apps list and a lone extension
            read as one balanced panel instead of two lopsided ones. */}
        <Panel title="Apps & extensions" count={registry.apps.length + registry.extensions.length}>
          <div className="console__subgroup">
            <h3 className="console__subtitle">Apps</h3>
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
          </div>

          <div className="console__subgroup">
            <h3 className="console__subtitle">Extensions</h3>
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
          </div>
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
