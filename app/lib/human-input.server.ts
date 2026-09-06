import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations, feedback } from "~/db/schema";
import {
  type CommitRecord,
  type ConsistencyChecks,
  type ConsistencyInput,
  checkInputConsistency,
  type HumanInputEvent,
  type SpineItem,
  truncate,
} from "./human-input";

export type {
  CommitRecord,
  ConsistencyChecks,
  ConsistencyInput,
  HumanInputEvent,
  InputDup,
  InputGap,
  InputIntent,
  InputSource,
  Interlude,
  SpineItem,
} from "./human-input";

/**
 * The Human-Input Log (ADR-010): a generated PROJECTION that owns no data. It unions the
 * captured Owner-input sources and derives the "work between inputs" (interludes) from
 * the control-plane git history. Since CoS-Threads (work-029, ADR-012) unified Chat +
 * Requests onto the one conversation primitive, Owner messages come from a **single**
 * source — `conversation_messages` where `role = owner` — and the per-input source/intent
 * is derived from the parent thread's `kind` (a `chat` thread → directive; a `request`
 * thread → its first owner message is the ask, later ones are replies). This is the
 * simplification ADR-012 promised over the old two-source (chat + requests) union.
 */

export async function listHumanInput(): Promise<HumanInputEvent[]> {
  await ensureSchema();
  const [convos, convMsgs, fbs, operatorEvents] = await Promise.all([
    db.select().from(conversations),
    db.select().from(conversationMessages),
    db.select().from(feedback),
    readOperatorSessions(),
  ]);

  const events: HumanInputEvent[] = [...operatorEvents];

  // One owner-message source; tag each by its thread's kind.
  const kindById = new Map(convos.map((c) => [c.id, c.kind]));
  const ownerByThread = new Map<number, typeof convMsgs>();
  for (const m of convMsgs) {
    if (m.role !== "owner") continue;
    const arr = ownerByThread.get(m.conversationId) ?? [];
    arr.push(m);
    ownerByThread.set(m.conversationId, arr);
  }
  for (const [threadId, arr] of ownerByThread) {
    const isRequest = kindById.get(threadId) === "request";
    arr.sort((a, b) => a.at - b.at);
    arr.forEach((m, i) => {
      events.push({
        id: `conv:${m.id}`,
        ts: m.at,
        source: isRequest ? (i === 0 ? "work-request" : "request-reply") : "console-chat",
        intent: isRequest ? (i === 0 ? "request" : "answer") : "directive",
        summary: truncate(m.body),
        excerpt: m.body,
        refUrl: `/threads/${threadId}`,
      });
    });
  }

  for (const f of fbs) {
    events.push({
      id: `fb:${f.id}`,
      ts: f.at,
      source: "feedback",
      intent: "feedback",
      summary: `Feedback ${f.rating === "up" ? "👍" : "👎"}${f.comment ? `: ${truncate(f.comment, 100)}` : ""}`,
      excerpt: f.comment || undefined,
      refUrl: "/explore",
    });
  }

  return events.sort((a, b) => b.ts - a.ts);
}

const exec = promisify(execFile);

function controlPlaneHome(): string {
  return process.env.SCOPE_CREEP_HOME ?? join(process.cwd(), "..", "scope-creep");
}

type OperatorRecord = {
  source?: string;
  ts?: number;
  session?: string;
  cwd?: string;
  text?: string;
};

/**
 * The terminal input surface (work-020, ADR-010): the UserPromptSubmit hook appends
 * one NDJSON line per Owner prompt to the control-plane's LOCAL, gitignored
 * human-input/YYYY-MM.ndjson. We read it here so first-class Claude-session inputs
 * join the timeline instead of showing as a "capture pending" gap. Best-effort: a
 * missing dir (hook not installed) or a malformed line is skipped, never thrown.
 */
async function readOperatorSessions(): Promise<HumanInputEvent[]> {
  const dir = join(controlPlaneHome(), "human-input");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".ndjson"));
  } catch {
    return [];
  }
  const events: HumanInputEvent[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(join(dir, file), "utf8");
    } catch {
      continue;
    }
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let rec: OperatorRecord;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const text = rec.text?.trim();
      if (!text || typeof rec.ts !== "number") continue;
      events.push({
        id: `op:${file}:${i}`,
        ts: rec.ts,
        source: "operator-session",
        intent: "directive",
        summary: truncate(text),
        excerpt: text,
      });
    }
  }
  return events;
}

/** Control-plane commit subjects in (fromTs, toTs] — the derived "work between inputs". */
export async function commitsBetween(fromTs: number, toTs: number): Promise<string[]> {
  try {
    const { stdout } = await exec(
      "git",
      [
        "-C",
        controlPlaneHome(),
        "log",
        "--no-merges",
        `--since=${new Date(fromTs).toISOString()}`,
        `--until=${new Date(toTs).toISOString()}`,
        "--format=%s",
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Control-plane commit record separator: git's %x1f emits the ASCII unit-separator
// byte, which never appears in a commit subject, so a subject with pipes/spaces stays
// intact when we split.
const FIELD_SEP = "\x1f";

/**
 * Real control-plane commits with their commit timestamps, newest-first, for the
 * consistency gap check (work-022). Unlike {@link commitsBetween}, this **includes
 * merges** — a merge is a real control-plane event that shipped work, so a window of
 * merges with no captured input is exactly the drift we want to catch. Reads live from
 * SCOPE_CREEP_HOME via `git log`; grounded in the actual record, never synthesized.
 * Best-effort: a non-repo home or a git failure yields [] (the caller then reports
 * "no data / can't verify", not a false all-clear).
 *
 * @param sinceTs optional lower bound (ms) — commits at/after it. Omit to read all.
 */
export async function commitsWithTimestamps(sinceTs?: number): Promise<CommitRecord[]> {
  const args = [
    "-C",
    controlPlaneHome(),
    "log",
    // %ct = committer date (unix seconds), %P = parent hashes (>1 ⇒ merge), %s = subject.
    `--format=%ct${FIELD_SEP}%P${FIELD_SEP}%s`,
  ];
  if (sinceTs !== undefined) args.push(`--since=${new Date(sinceTs).toISOString()}`);
  try {
    const { stdout } = await exec("git", args, { maxBuffer: 8 * 1024 * 1024 });
    const commits: CommitRecord[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [ct, parents, subject] = line.split(FIELD_SEP);
      const seconds = Number(ct);
      if (!Number.isFinite(seconds)) continue;
      commits.push({
        ts: seconds * 1000,
        subject: (subject ?? "").trim(),
        merge: (parents ?? "").trim().split(/\s+/).filter(Boolean).length > 1,
      });
    }
    return commits;
  } catch {
    return [];
  }
}

// How far back to look for orphaned control-plane work when NO input has been captured
// at all — the "hook never installed / stopped capturing" case. With captured inputs
// present we anchor the window at the earliest one instead (see inputConsistency).
const NO_INPUT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The grounded consistency self-check (work-022, ADR-010): read the real captured inputs
 * and the real control-plane commits, then run the pure {@link checkInputConsistency}.
 *
 * Observation window (honest, low-noise):
 *  - With captured inputs, we observe control-plane commits from the **earliest** input
 *    onward. Ordinary work *between* inputs is an interlude, not a gap; the gap we flag is
 *    control-plane work with no captured input preceding it at all.
 *  - With **no** captured input, we look back {@link NO_INPUT_LOOKBACK_MS}: any commit in
 *    that window is orphaned work the log can't account for — the strongest drift signal
 *    (an uninstalled/misfiring capture hook). If there's neither input nor commit, the
 *    check reports `hasData:false` ("can't verify"), never a false all-clear.
 */
export async function inputConsistency(): Promise<ConsistencyChecks> {
  const events = await listHumanInput();
  const earliestInputTs = events.length > 0 ? Math.min(...events.map((e) => e.ts)) : undefined;
  const sinceTs = earliestInputTs ?? Date.now() - NO_INPUT_LOOKBACK_MS;
  const commits = await commitsWithTimestamps(sinceTs);
  const inputs: ConsistencyInput[] = events.map(({ id, ts, summary, excerpt }) => ({
    id,
    ts,
    summary,
    excerpt,
  }));
  return checkInputConsistency(inputs, commits);
}

/** The spine: inputs (newest-first) with interludes derived between consecutive ones. */
export async function buildSpine(): Promise<SpineItem[]> {
  const events = await listHumanInput();
  const spine: SpineItem[] = [];
  for (let i = 0; i < events.length; i++) {
    spine.push({ kind: "input", input: events[i] });
    const older = events[i + 1];
    if (older) {
      const commits = await commitsBetween(older.ts, events[i].ts);
      if (commits.length > 0) {
        spine.push({
          kind: "interlude",
          interlude: { fromTs: older.ts, toTs: events[i].ts, commits },
        });
      }
    }
  }
  return spine;
}
