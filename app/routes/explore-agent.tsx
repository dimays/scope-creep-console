import { ActivityRow } from "@scope-creep/design";
import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { activityForActor, activityHref, activityVerb, readAgent } from "~/lib/explore.server";
import type { Route } from "./+types/explore-agent";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.name} · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const agent = await readAgent(params.name);
  if (!agent) throw new Response("Not found", { status: 404 });
  // Recent activity (work-037): the spawns/delegations/confers this agent was the
  // actor of, from work-036's log — honest-empty until that hook lands.
  const activity = (await activityForActor(params.name)).slice(0, 20).map((e) => ({
    ...e,
    verb: activityVerb(e.type),
    href: activityHref(e),
  }));
  return { agent, activity };
}

export default function ExploreAgent({ loaderData }: Route.ComponentProps) {
  const { agent, activity } = loaderData;
  const isEmployee = agent.kind === "employee";
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">
            {isEmployee ? "Employee" : "Agent"}
            {agent.status ? ` · ${agent.status}` : ""}
          </p>
          <h1 className="console__title">{agent.displayName}</h1>
        </div>
        <Link to="/explore/agents" className="console__meta">
          ← org
        </Link>
      </header>
      <ExploreNav />
      <p className="doc-path">{agent.description}</p>

      {(agent.reportsTo || agent.template) && (
        <p className="console__meta org__profile-meta">
          {agent.reportsTo && (
            <>
              reports to <Link to={`/explore/agents/${agent.reportsTo}`}>{agent.reportsTo}</Link>
            </>
          )}
          {agent.reportsTo && agent.template && " · "}
          {agent.template && (
            <>
              template <Link to={`/explore/templates/${agent.template}`}>{agent.template}</Link>
            </>
          )}
        </p>
      )}

      {/* Eval — Phase-1 contribution history (adr-015 / work-007). Attribution-grounded,
          descriptive, NOT a score; every item links to the real artifact, and the signals
          that can't be grounded yet are named honestly rather than shown as an earned zero. */}
      <section className="doc-group eval-history">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Eval — contribution history</h2>
          <span className="console__tag">Phase 1 · not a score</span>
        </div>
        <p className="console__empty">
          A transparent, attribution-grounded projection of what this agent{" "}
          <strong>authored</strong> — descriptive, never a score (adr-015). Each item links to the
          real artifact.
        </p>
        <EvalGroup label="ADRs led" items={agent.evalHistory.adrsLed} />
        <EvalGroup label="Ledger entries authored" items={agent.evalHistory.ledgerAuthored} />
        <EvalGroup
          label="Mentioned (not authored)"
          items={agent.evalHistory.ledgerMentioned}
          muted
        />
        <details className="eval-gaps">
          <summary className="console__meta">Signals not yet captured (never faked)</summary>
          <ul className="console__list eval-gaps__list">
            {agent.evalHistory.notYetCaptured.map((g) => (
              <li key={g} className="console__empty">
                {g}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Staffed to</h2>
          <span className="console__count">{agent.staffing.length}</span>
        </div>
        {agent.staffing.length === 0 ? (
          <p className="console__empty">Not staffed to any tickets.</p>
        ) : (
          <ul className="console__list">
            {agent.staffing.map((t) => (
              <li key={t.id} className="doc-row">
                <Link to={`/work/${t.id}`} className="console__item-name">
                  {t.title}
                </Link>
                <span className="console__tag">{t.role === "owner" ? "owner" : "staffed"}</span>
                <span className="console__tag">{t.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {agent.directReports.length > 0 && (
        <section className="doc-group">
          <div className="console__panel-head">
            <h2 className="doc-group__title">Direct reports</h2>
            <span className="console__count">{agent.directReports.length}</span>
          </div>
          <ul className="console__list">
            {agent.directReports.map((r) => (
              <li key={r.name} className="doc-row">
                <Link to={`/explore/agents/${r.name}`} className="console__item-name">
                  {r.name}
                </Link>
                {r.template && <span className="console__tag">{r.template}</span>}
                {r.status && r.status !== "active" && (
                  <span className="console__tag">{r.status}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Recent activity</h2>
          <span className="console__count">{activity.length}</span>
        </div>
        {activity.length === 0 ? (
          <p className="console__empty">
            No activity captured yet. Spin-ups, delegations, and confers appear here once the
            capture hook (<code>work-036</code>) is wired — never inferred from prose.
          </p>
        ) : (
          <div className="activity-feed">
            {activity.map((e) => (
              <ActivityRow
                key={e.id ?? `${e.ts}-${e.summary}`}
                className="activity-row"
                time={e.ts ?? undefined}
                href={e.href ?? undefined}
              >
                <span className="activity-row__verb">{e.verb}</span> {e.summary}
              </ActivityRow>
            ))}
          </div>
        )}
      </section>

      <section className="doc-group">
        <div className="console__panel-head">
          <h2 className="doc-group__title">Loops owned</h2>
          <span className="console__count">{agent.loopsOwned.length}</span>
        </div>
        {agent.loopsOwned.length === 0 ? (
          <p className="console__empty">This agent owns no loops.</p>
        ) : (
          <ul className="console__list">
            {agent.loopsOwned.map((loop) => (
              <li key={loop.name} className="doc-row">
                <Link to={`/explore/loops/${loop.name}`} className="console__item-name">
                  {loop.name}
                </Link>
                {loop.status && <span className="console__tag">{loop.status}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Charter</h2>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, single-user control-plane markdown */}
        <article className="prose" dangerouslySetInnerHTML={{ __html: agent.charterHtml }} />
      </section>
    </main>
  );
}

/** One grounded eval signal group: a labeled count + the linked artifacts, or an
 *  honest "none yet" when empty (adr-015 empty-is-empty). `muted` styles the
 *  mention-only group so it reads as secondary to authored signals. */
function EvalGroup({
  label,
  items,
  muted,
}: {
  label: string;
  items: { title: string; href: string }[];
  muted?: boolean;
}) {
  return (
    <div className={muted ? "eval-group eval-group--muted" : "eval-group"}>
      <div className="eval-group__head">
        <span className="eval-group__label">{label}</span>
        <span className="console__count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="console__empty">None yet.</p>
      ) : (
        <ul className="console__list">
          {items.map((it) => (
            <li key={it.href} className="doc-row">
              <Link to={it.href} className="console__item-name">
                {it.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
