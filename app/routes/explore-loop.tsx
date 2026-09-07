import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import {
  agentDisplayName,
  cadenceHistoryFor,
  describeCron,
  listDocs,
  loopLaunch,
  readLoop,
  readRoutines,
} from "~/lib/explore.server";
import type { Route } from "./+types/explore-loop";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.name} · Loop · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const loop = await readLoop(params.name);
  if (!loop) throw new Response("Not found", { status: 404 });
  // The loop's markdown lives in the docs graph under its own name (loop docs use
  // `name:` frontmatter that matches the registry entry) — link to it when present.
  const [docs, { routines }, cadence] = await Promise.all([
    listDocs(),
    readRoutines(),
    cadenceHistoryFor(loop.name),
  ]);
  const docSlug = docs.some((d) => d.slug === loop.name) ? loop.name : null;
  const routine = routines.find((r) => r.loop === loop.name) ?? null;
  return {
    loop,
    ownerDisplay: loop.ownerAgent ? agentDisplayName(loop.ownerAgent) : null,
    docSlug,
    // Schedule & cadence (work-052): a scheduled loop carries a cloud routine; an
    // event-driven loop carries none and gets an "open in Claude" launcher instead.
    schedule: routine
      ? { routine: { ...routine, cronText: describeCron(routine.cron) }, cadence }
      : null,
    launch: routine ? null : loopLaunch(loop.name),
  };
}

export default function ExploreLoop({ loaderData }: Route.ComponentProps) {
  const { loop, ownerDisplay, docSlug, schedule, launch } = loaderData;
  const eyebrow = [loop.kind, loop.status, loop.mode].filter(Boolean).join(" · ");
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">{eyebrow}</p>
          <h1 className="console__title">{loop.name}</h1>
        </div>
        <Link to="/explore/loops" className="console__meta">
          ← loops
        </Link>
      </header>
      <ExploreNav />
      {loop.description && <p className="doc-path">{loop.description}</p>}

      <section className="doc-group">
        <h2 className="doc-group__title">Owner</h2>
        {loop.ownerAgent && ownerDisplay ? (
          <ul className="console__list">
            <li className="doc-row">
              <Link to={`/explore/agents/${loop.ownerAgent}`} className="console__item-name">
                {ownerDisplay}
              </Link>
              <span className="console__tag">owner_agent</span>
            </li>
          </ul>
        ) : (
          <p className="console__empty">No owning agent recorded.</p>
        )}
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Definition</h2>
        {docSlug ? (
          <ul className="console__list">
            <li className="doc-row">
              <Link to={`/explore/docs/${docSlug}`} className="console__item-name">
                Read the loop
              </Link>
              {loop.path && <span className="console__tag">{loop.path}</span>}
            </li>
          </ul>
        ) : (
          <p className="console__empty">
            {loop.path ? `Defined at ${loop.path}.` : "No definition path recorded."}
          </p>
        )}
      </section>

      <section className="doc-group">
        <h2 className="doc-group__title">Schedule &amp; cadence</h2>
        {schedule ? (
          <>
            <ul className="console__list">
              <li className="doc-row">
                <span className="console__item-name">{schedule.routine.cronText}</span>
                <span className="console__tag">cron floor</span>
              </li>
              {schedule.routine.cadenceBoundsDays && (
                <li className="doc-row">
                  <span className="console__item-name">
                    self-tunes {schedule.routine.cadenceBoundsDays[0]}–
                    {schedule.routine.cadenceBoundsDays[1]} days
                  </span>
                  <span className="console__tag">cadence bounds</span>
                </li>
              )}
              <li className="doc-row">
                <span className="console__meta">
                  Next due run:{" "}
                  {schedule.cadence[0]?.ranAt && schedule.cadence[0]?.nextCadenceDays
                    ? `${schedule.cadence[0].ranAt} + ${schedule.cadence[0].nextCadenceDays}d`
                    : "unknown until the first run lands a cadence-decision"}
                </span>
              </li>
              <li className="doc-row">
                <a
                  href={schedule.routine.manageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="console__item-name"
                >
                  Manage in claude.ai ↗
                </a>
                <span className="console__tag">enable / disable / run-now happen there</span>
              </li>
            </ul>

            <h3 className="doc-group__subtitle">Self-tuning cadence history</h3>
            {schedule.cadence.length === 0 ? (
              <p className="console__empty">
                No cadence history yet — this loop hasn't run. Each run appends a{" "}
                <code>cadence-decision</code> block to the ledger; the lengthen / shorten / hold
                trail (with the CoS's reasons) builds here.
              </p>
            ) : (
              <ul className="console__list cadence-timeline">
                {schedule.cadence.map((d) => (
                  <li
                    key={`${d.ranAt}-${d.trigger}-${d.decision}-${d.nextCadenceDays}`}
                    className="doc-row"
                  >
                    <span className="console__item-name">{d.ranAt ?? "—"}</span>
                    {d.decision && (
                      <span className={`console__tag cadence-${d.decision}`}>{d.decision}</span>
                    )}
                    {d.trigger && <span className="console__tag">{d.trigger}</span>}
                    {typeof d.nextCadenceDays === "number" && (
                      <span className="console__meta">→ {d.nextCadenceDays}d</span>
                    )}
                    {d.reason && <p className="console__empty">{d.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="console__empty">
              <strong>Event-driven</strong> — this loop fires in the harness (a request batch, a
              chosen track, an Owner kickoff), not on a wall clock. It has no cadence and no cloud
              routine.
            </p>
            {launch && (
              <div className="launcher__cmdrow" style={{ marginTop: "0.5rem" }}>
                <a className="console__item-name" href={launch.deepLink}>
                  Open in Claude Code ↗
                </a>
                <span className="console__meta">
                  or run: <code>{launch.cliCommand}</code>
                </span>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
