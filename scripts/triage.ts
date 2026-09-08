#!/usr/bin/env node
/**
 * `request-triage` runner CLI (work-066) — the shell contract the scheduled claude.ai Code
 * Routine drives. The routine session reasons (the triage *judgment*); this CLI is the
 * mechanism it calls. Three verbs, all JSON in/out, all honouring `--dry-run` so the runner
 * is exercisable with no provisioned remote DB and no registered routine:
 *
 *   triage sweep
 *       List new owner-initiated request threads awaiting triage (JSON array). This is the
 *       routine's input — it reads the shared thread store via DATABASE_URL/DATABASE_AUTH_TOKEN
 *       (ADR-024). A remote outage surfaces as a non-zero exit + error, never an empty list.
 *
 *   triage write-back --thread N --kind critical-update|needs-input --label "…" [--body "…"]
 *                      [--status working|needs-you|closed] [--ref-url URL] [--ref-label "…"]
 *                      [--author slug] [--dry-run]
 *       Post the triage outcome back into a thread (loop step 4).
 *
 *   triage author-ticket --spec ticket.json [--dry-run]
 *       Render a work/NNN ticket and stage it as a gated PR in the control plane (loop step 3).
 *       Never merges. `ticket.json` is a {@link TicketSpec} minus `num` (auto-assigned unless
 *       given). Auto-merge of a simple accept is the gated ADR-022 finish line, not done here.
 *
 * Run from the console checkout with the environment ADR-024 describes. Example (dry, local):
 *   DATABASE_URL=file:./data/app.db bun run scripts/triage.ts sweep
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ThreadStatus } from "~/lib/threads";
import {
  authorTicketPR,
  listNewRequestThreads,
  nextTicketId,
  type TicketSpec,
  type TriageOutcomeKind,
  writeBackOutcome,
} from "~/lib/triage.server";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function sweep(): Promise<void> {
  // A store outage must surface (ADR-024) — let it throw to a non-zero exit, never [].
  const threads = await listNewRequestThreads();
  print(
    threads.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      href: `/threads/${t.id}`,
    })),
  );
}

async function writeBack(opts: Record<string, string | boolean | undefined>): Promise<void> {
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

async function authorTicket(opts: Record<string, string | boolean | undefined>): Promise<void> {
  if (!opts.spec) fail("author-ticket: --spec ticket.json is required");
  const raw = JSON.parse(await readFile(String(opts.spec), "utf8")) as Partial<TicketSpec>;
  const num = raw.num ?? (await nextTicketId());
  for (const field of ["slug", "title", "type", "owner", "body"] as const) {
    if (!raw[field]) fail(`author-ticket: spec.${field} is required`);
  }
  const result = await authorTicketPR(
    { ...(raw as TicketSpec), num },
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
      thread: { type: "string" },
      kind: { type: "string" },
      label: { type: "string" },
      body: { type: "string" },
      status: { type: "string" },
      "ref-url": { type: "string" },
      "ref-label": { type: "string" },
      author: { type: "string" },
      spec: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  switch (command) {
    case "sweep":
      return sweep();
    case "write-back":
      return writeBack(values);
    case "author-ticket":
      return authorTicket(values);
    default:
      fail(
        `Usage: triage <sweep|write-back|author-ticket> [options]\nUnknown command: ${command ?? "(none)"}`,
      );
  }
}

main().catch((err) => {
  fail(err instanceof Error ? `triage: ${err.message}` : `triage: ${String(err)}`);
});
