import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { agentDisplayName } from "~/lib/display-name";
import { readTemplate } from "~/lib/explore.server";
import type { Route } from "./+types/explore-template";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.name} template · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const template = await readTemplate(params.name);
  if (!template) throw new Response("Not found", { status: 404 });
  return template;
}

export default function ExploreTemplate({ loaderData }: Route.ComponentProps) {
  const t = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Employee template{t.status ? ` · ${t.status}` : ""}</p>
          <h1 className="console__title">{t.displayName}</h1>
        </div>
        <Link to="/explore/templates" className="console__meta">
          ← templates
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">{t.description}</p>

      <p className="console__meta">
        {t.defaultModel && (
          <>
            default model <code>{t.defaultModel}</code>
          </>
        )}
      </p>
      {t.skills.length > 0 && (
        <p className="org__skills">
          {t.skills.map((s) => (
            <span key={s} className="console__tag">
              {s}
            </span>
          ))}
        </p>
      )}

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Roster</h2>
          <span className="console__count">{t.roster.length}</span>
        </div>
        {t.roster.length === 0 ? (
          <p className="console__empty">No employees instantiated from this template yet.</p>
        ) : (
          <ul className="console__list">
            {t.roster.map((e) => (
              <li key={e.name} className="doc-row">
                <Link to={`/explore/agents/${e.name}`} className="console__item-name">
                  {agentDisplayName(e.name)}
                </Link>
                {e.reportsTo && <span className="console__tag">→ {e.reportsTo}</span>}
                {e.status && e.status !== "active" && (
                  <span className="console__tag">{e.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Operating manual</h2>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, single-user control-plane markdown */}
        <article className="prose" dangerouslySetInnerHTML={{ __html: t.manualHtml }} />
      </section>
    </main>
  );
}
