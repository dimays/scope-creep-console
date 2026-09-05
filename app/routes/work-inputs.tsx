import { Link } from "react-router";
import { WorkNav } from "~/components/work-nav";
import { buildSpine } from "~/lib/human-input.server";
import type { Route } from "./+types/work-inputs";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Inputs · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const spine = await buildSpine();
  const inputs = spine.filter((s) => s.kind === "input").length;
  const commits = spine.reduce(
    (n, s) => n + (s.kind === "interlude" ? s.interlude.commits.length : 0),
    0,
  );
  return { spine, inputs, commits };
}

function fmt(ts: number): string {
  // Deterministic UTC (avoids SSR/client hydration mismatch).
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

export default function WorkInputs({ loaderData }: Route.ComponentProps) {
  const { spine, inputs, commits } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Human Input</h1>
        </div>
        <p className="console__meta">
          {inputs} input{inputs === 1 ? "" : "s"} · {commits} commits between them
        </p>
      </header>
      <WorkNav />

      <p className="console__notice">
        Every discrete human input, newest first — in-app chat, requests, and feedback, plus
        terminal (<code>operator-session</code>) prompts captured by the local hook (work-020). Gate
        (<code>owner-action</code>) capture is still to come.
      </p>

      {spine.length === 0 ? (
        <p className="console__empty">No captured inputs yet.</p>
      ) : (
        <ol className="spine">
          {spine.map((item) =>
            item.kind === "input" ? (
              <li key={item.input.id} className="spine__input">
                <div className="input-chips">
                  <span className={`chip chip--${item.input.source}`}>{item.input.source}</span>
                  <span className="chip chip--intent">{item.input.intent}</span>
                  <span className="input-when">{fmt(item.input.ts)}</span>
                </div>
                <p className="input-summary">
                  {item.input.refUrl ? (
                    <Link to={item.input.refUrl} className="input-link">
                      {item.input.summary}
                    </Link>
                  ) : (
                    item.input.summary
                  )}
                </p>
              </li>
            ) : (
              <li
                key={`i-${item.interlude.fromTs}-${item.interlude.toTs}`}
                className="spine__interlude"
              >
                <p className="interlude__head">
                  Between these, the system shipped {item.interlude.commits.length} commit
                  {item.interlude.commits.length === 1 ? "" : "s"}:
                </p>
                <ul className="interlude__commits">
                  {item.interlude.commits.slice(0, 8).map((c) => (
                    <li key={`${item.interlude.toTs}:${c}`}>{c}</li>
                  ))}
                  {item.interlude.commits.length > 8 && (
                    <li className="interlude__more">+{item.interlude.commits.length - 8} more</li>
                  )}
                </ul>
              </li>
            ),
          )}
        </ol>
      )}
    </main>
  );
}
