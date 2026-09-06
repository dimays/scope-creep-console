import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations, feedback } from "~/db/schema";
import { type HumanInputEvent, type SpineItem, truncate } from "./human-input";

export type {
  HumanInputEvent,
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
