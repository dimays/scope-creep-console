#!/usr/bin/env node
/**
 * `work-sweep` runner CLI (work-086, [[work-sweep]] loop, [[prd-autonomous-execution-loop]],
 * ADR-025 runner topology) — the shell contract the scheduled execution-loop routine drives.
 * The routine session reasons (drive a ticket through the dev-cycle, decide proceed/park); this
 * CLI is the *mechanism* it calls. All verbs are JSON in/out and honour `--dry-run` where they
 * side-effect, so the runner is exercisable with no provisioned remote DB and no registered
 * routine.
 *
 * This runner is MECHANISM, not judgment. It **never authors tickets** (that is request-triage)
 * and it **never merges** (ADR-022 independent review, author ≠ merger, is the finish line) — it
 * reads the board and stages/writes-back only.
 *
 *   work-sweep sweep [--floor high|medium|low]
 *       Read the control-plane board and print the ready set + activeCount/wipCap/atCap/exhausted
 *       (loop step 1). Reads the board via SCOPE_CREEP_HOME. A read failure surfaces as a
 *       non-zero exit, never a silently-empty set.
 *
 *   work-sweep milestone --just-completed <id> [--floor …] [--unreleased N] [--release-threshold M]
 *       Evaluate the milestone stop-rule after a ticket lands (loop step 2): the fired triggers,
 *       for the session to act on. Reads the board.
 *
 *   work-sweep cadence --current D --backlog N --owner-pull-rate R --wip W --min D --max D
 *                      [--trigger "…"] [--ran-at ISO]
 *       Decide the next cadence from live signal + render the `cadence-decision` block (pure;
 *       `--ran-at` is injectable, defaults to now).
 *
 *   work-sweep write-back --thread N --kind critical-update|needs-input --label "…" [--body "…"]
 *                         [--status working|needs-you|closed] [--ref-url URL] [--ref-label "…"]
 *                         [--author slug] [--dry-run]
 *       Post a loop outcome back into a thread (loop step 4). Reuses the SAME writer as the
 *       request-triage runner ({@link writeBackOutcome}).
 *
 * Run under **Node (via tsx), NOT `bun run`.** Bun's fetch is dropped by the cloud routine's
 * egress proxy (`ECONNRESET` / `ws_closed_mid_exchange`), so `bun run scripts/work-sweep.ts`
 * fails through the proxy even though the same request succeeds under Node — the routine must
 * invoke the Node path. See work-065 / ADR-024. The `work-sweep` package.json script
 * (`tsx scripts/work-sweep.ts`) is the reliable Node entry point:
 *   npm run work-sweep -- sweep                      # the Routine's invocation (Node/tsx)
 *   node --import tsx scripts/work-sweep.ts sweep     # equivalent, no npm indirection
 *
 * Run from the console checkout with SCOPE_CREEP_HOME pointing at the control plane, and (for
 * write-back) the ADR-024 remote DB env. Example (local file db):
 *   SCOPE_CREEP_HOME=../scope-creep DATABASE_URL=file:./data/app.db npm run work-sweep -- sweep
 */

import { parseArgs } from "node:util";
import type { ThreadStatus } from "~/lib/threads";
import { listWork } from "~/lib/work.server";
import { evaluateMilestone, type Priority } from "~/lib/work-sweep";
import {
  buildMilestoneSnapshot,
  planCadence,
  sweep,
  type TriageOutcomeKind,
  writeBackOutcome,
} from "~/lib/work-sweep.server";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseFloor(raw: string | undefined): Priority | undefined {
  if (raw == null) return undefined;
  if (raw !== "high" && raw !== "medium" && raw !== "low") {
    fail("--floor must be high, medium, or low");
  }
  return raw;
}

async function runSweep(opts: Record<string, string | boolean | undefined>): Promise<void> {
  // A board read failure must surface (ADR-024/ADR-025) — let it throw to a non-zero exit.
  const result = await sweep({ floor: parseFloor(opts.floor as string | undefined) });
  print(result);
}

async function runMilestone(opts: Record<string, string | boolean | undefined>): Promise<void> {
  const justCompleted = opts["just-completed"] ? String(opts["just-completed"]) : "";
  if (!justCompleted) fail("milestone: --just-completed <id> is required");
  const items = await listWork();
  const snap = buildMilestoneSnapshot(items, justCompleted, {
    floor: parseFloor(opts.floor as string | undefined),
    unreleasedCount: opts.unreleased != null ? Number(opts.unreleased) : undefined,
    releaseThreshold:
      opts["release-threshold"] != null ? Number(opts["release-threshold"]) : undefined,
  });
  print({ justCompleted, triggers: evaluateMilestone(snap), snapshot: snap });
}

function runCadence(opts: Record<string, string | boolean | undefined>): void {
  for (const field of ["current", "backlog", "owner-pull-rate", "wip", "min", "max"] as const) {
    if (opts[field] == null) fail(`cadence: --${field} is required`);
  }
  const result = planCadence(
    {
      currentCadenceDays: Number(opts.current),
      readyBacklogDepth: Number(opts.backlog),
      ownerPullRate: Number(opts["owner-pull-rate"]),
      wipActive: Number(opts.wip),
    },
    { minDays: Number(opts.min), maxDays: Number(opts.max) },
    {
      ranAt: opts["ran-at"] ? String(opts["ran-at"]) : new Date().toISOString(),
      trigger: opts.trigger ? String(opts.trigger) : "work-sweep",
    },
  );
  print(result);
}

async function runWriteBack(opts: Record<string, string | boolean | undefined>): Promise<void> {
  const threadId = Number(opts.thread);
  if (!Number.isInteger(threadId)) fail("write-back: --thread N is required");
  const kind = String(opts.kind ?? "") as TriageOutcomeKind;
  if (kind !== "critical-update" && kind !== "needs-input") {
    fail("write-back: --kind must be critical-update or needs-input");
  }
  if (!opts.label) fail("write-back: --label is required");
  const result = await writeBackOutcome(
    threadId,
    kind,
    {
      label: String(opts.label),
      body: opts.body ? String(opts.body) : undefined,
      refUrl: opts["ref-url"] ? String(opts["ref-url"]) : undefined,
      refLabel: opts["ref-label"] ? String(opts["ref-label"]) : undefined,
      author: opts.author ? String(opts.author) : undefined,
      status: opts.status ? (String(opts.status) as ThreadStatus) : undefined,
    },
    { dryRun: !!opts["dry-run"] },
  );
  print(result);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      floor: { type: "string" },
      "just-completed": { type: "string" },
      unreleased: { type: "string" },
      "release-threshold": { type: "string" },
      current: { type: "string" },
      backlog: { type: "string" },
      "owner-pull-rate": { type: "string" },
      wip: { type: "string" },
      min: { type: "string" },
      max: { type: "string" },
      trigger: { type: "string" },
      "ran-at": { type: "string" },
      thread: { type: "string" },
      kind: { type: "string" },
      label: { type: "string" },
      body: { type: "string" },
      status: { type: "string" },
      "ref-url": { type: "string" },
      "ref-label": { type: "string" },
      author: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  switch (command) {
    case "sweep":
      return runSweep(values);
    case "milestone":
      return runMilestone(values);
    case "cadence":
      return runCadence(values);
    case "write-back":
      return runWriteBack(values);
    default:
      fail(
        `Usage: work-sweep <sweep|milestone|cadence|write-back> [options]\nUnknown command: ${command ?? "(none)"}`,
      );
  }
}

main().catch((err) => {
  fail(err instanceof Error ? `work-sweep: ${err.message}` : `work-sweep: ${String(err)}`);
});
