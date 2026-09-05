import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { db, ensureSchema } from "~/db";
import { conversationMessages, feedback, requestMessages } from "~/db/schema";
import { type HumanInputEvent, type Interlude, type SpineItem, truncate } from "./human-input";

export type {
  HumanInputEvent,
  InputIntent,
  InputSource,
  Interlude,
  SpineItem,
} from "./human-input";

/**
 * The Human-Input Log (ADR-010): a generated PROJECTION that owns no data. v1a unions
 * the three already-captured Owner-input sources in the Console DB, and derives the
 * "work between inputs" (interludes) from the control-plane git history. Terminal
 * (operator-session) + gate (owner-action) capture arrive in work-020.
 */

export async function listHumanInput(): Promise<HumanInputEvent[]> {
  await ensureSchema();
  const [chats, reqMsgs, fbs] = await Promise.all([
    db.select().from(conversationMessages),
    db.select().from(requestMessages),
    db.select().from(feedback),
  ]);

  const events: HumanInputEvent[] = [];

  for (const m of chats) {
    if (m.role !== "owner") continue;
    events.push({
      id: `chat:${m.id}`,
      ts: m.at,
      source: "console-chat",
      intent: "directive",
      summary: truncate(m.body),
      excerpt: m.body,
      refUrl: "/chat",
    });
  }

  // Group a request's owner messages: the first is the ask, later ones are replies.
  const byReq = new Map<number, typeof reqMsgs>();
  for (const rm of reqMsgs) {
    if (rm.author !== "owner") continue;
    const arr = byReq.get(rm.requestId) ?? [];
    arr.push(rm);
    byReq.set(rm.requestId, arr);
  }
  for (const [reqId, arr] of byReq) {
    arr.sort((a, b) => a.at - b.at);
    arr.forEach((rm, i) => {
      events.push({
        id: `req:${rm.id}`,
        ts: rm.at,
        source: i === 0 ? "work-request" : "request-reply",
        intent: i === 0 ? "request" : "answer",
        summary: truncate(rm.body),
        excerpt: rm.body,
        refUrl: `/work/requests/${reqId}`,
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
