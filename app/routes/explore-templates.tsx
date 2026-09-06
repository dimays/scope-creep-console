import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { agentDisplayName } from "~/lib/display-name";
import { employeesOfTemplate } from "~/lib/org.server";
import { readRegistry } from "~/lib/registry.server";
import type { Route } from "./+types/explore-templates";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Templates · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const registry = await readRegistry();
  const templates = registry.templates.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    defaultModel: t.default_model ?? "",
    skills: t.skills ?? [],
    roster: employeesOfTemplate(registry.agents, t.name).map((e) => e.name),
  }));
  return { available: registry.available, home: registry.home, templates };
}

export default function ExploreTemplates({ loaderData }: Route.ComponentProps) {
  const { available, home, templates } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Employee templates</h1>
        </div>
        <Link to="/explore/agents" className="console__meta">
          org →
        </Link>
      </header>
      <ExploreNav />

      {!available && (
        <p className="console__notice">
          Control plane not found at <code>{home}</code>. Set <code>SCOPE_CREEP_HOME</code>.
        </p>
      )}

      <p className="doc-path">
        Off-the-shelf role archetypes executives staff from. Create or modify one from the{" "}
        <Link to="/explore/agents">org view</Link> (ADR-017).
      </p>

      {templates.length === 0 ? (
        <p className="console__empty">No employee templates yet.</p>
      ) : (
        <section className="console__grid">
          {templates.map((t) => (
            <article key={t.name} className="console__panel">
              <div className="console__panel-head">
                <h2 className="console__panel-title">
                  <Link to={`/explore/templates/${t.name}`} className="console__item-name">
                    {t.name}
                  </Link>
                </h2>
                <span className="console__count">{t.roster.length}</span>
              </div>
              <p className="console__empty">{t.description}</p>
              {t.skills.length > 0 && (
                <p className="org__skills">
                  {t.skills.map((s) => (
                    <span key={s} className="console__tag">
                      {s}
                    </span>
                  ))}
                </p>
              )}
              {t.roster.length > 0 && (
                <p className="console__meta">
                  {t.roster.map((slug, i) => (
                    <span key={slug}>
                      {i > 0 && ", "}
                      <Link to={`/explore/agents/${slug}`}>{agentDisplayName(slug)}</Link>
                    </span>
                  ))}
                </p>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
