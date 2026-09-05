import { Link } from "react-router";
import { ExploreNav } from "~/components/explore-nav";
import { FeedbackMount } from "~/components/feedback-mount";
import { db, ensureSchema } from "~/db";
import { feedback } from "~/db/schema";
import { consistency, listDocs, listLedger } from "~/lib/explore.server";
import { readRegistry } from "~/lib/registry.server";
import type { Route } from "./+types/explore";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Explore · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  await ensureSchema();
  const [docs, ledger, registry, report, feedbackRows] = await Promise.all([
    listDocs(),
    listLedger(),
    readRegistry(),
    consistency(),
    db.select().from(feedback),
  ]);
  return {
    counts: { docs: docs.length, agents: registry.agents.length, ledger: ledger.length },
    issues:
      report.danglingLinks.length +
      report.proposedDocs.length +
      report.ungeneratedRegistries.length +
      report.staleDocs.length,
    feedbackCount: feedbackRows.length,
  };
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { counts, issues, feedbackCount } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Explore</h1>
        </div>
        <p className="console__meta">Understand the platform without the codebase.</p>
      </header>
      <ExploreNav />
      <section className="console__grid">
        <ExploreCard to="/explore/docs" title="Docs" count={counts.docs}>
          Charter, standards, ADRs, product specs, and loops.
        </ExploreCard>
        <ExploreCard to="/explore/timeline" title="Timeline" count={counts.ledger}>
          Every recorded decision and event, newest first.
        </ExploreCard>
        <ExploreCard to="/explore/consistency" title="Consistency" count={issues} warn={issues > 0}>
          {issues > 0
            ? `${issues} thing${issues === 1 ? "" : "s"} worth a look.`
            : "Nothing out of sync."}
        </ExploreCard>
      </section>
      <p className="console__meta" style={{ marginTop: "1.25rem" }}>
        Agents live on the <Link to="/">dashboard</Link> — open one for its profile.
        {feedbackCount > 0 ? ` · ${feedbackCount} feedback recorded` : ""}
      </p>
      <FeedbackMount
        contextKey="console/explore/overview"
        question="Is Explore helping you understand the platform?"
      />
    </main>
  );
}

function ExploreCard({
  to,
  title,
  count,
  warn,
  children,
}: {
  to: string;
  title: string;
  count: number;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link to={to} className="console__panel explore-card">
      <div className="console__panel-head">
        <h2 className="console__panel-title">{title}</h2>
        <span className={warn ? "console__count console__count--warn" : "console__count"}>
          {count}
        </span>
      </div>
      <p className="console__empty">{children}</p>
    </Link>
  );
}
