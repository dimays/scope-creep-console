import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";
import { SubmitButton } from "~/components/state";

/**
 * The Threads launcher UI (work-046, ADR-016). Two modes:
 *  - `ThreadLauncher` (not launched): the compose form whose Submit opens a NEW Claude Code
 *    session seeded with the typed message. The in-app input lives here and *only* here.
 *  - `ResumePanel` (launched): the in-app input is gone; this fires the `claude-cli://` deep
 *    link once, then shows a "Resume in Claude" slot — honest about whether the handler scheme
 *    is registered and whether the control-plane home resolved. The resume slot only ever shows
 *    the correlated `claude --resume <uuid>` command; it NEVER opens a new session (work-100).
 *
 * Nothing here calls Claude. Opening is an OS URL-scheme launch (or a copied shell command);
 * resuming is a copyable CLI command; the transcript is projected from local session data by
 * the server.
 */

export function ThreadLauncher({ seed, launching }: { seed: string; launching: boolean }) {
  return (
    <Form method="post" className="req-form launcher">
      <input type="hidden" name="intent" value="launch" />
      <p className="launcher__hint">
        Submitting opens a <strong>new Claude Code session</strong> in the control-plane repo,
        seeded with this message. The conversation happens in Claude; this thread then projects its
        transcript back here — the app never calls Claude on your behalf.
      </p>
      <textarea
        name="body"
        className="req-textarea"
        defaultValue={seed}
        placeholder="What do you want to hand to your Chief of Staff?"
        disabled={launching}
        required
      />
      <div className="req-actions">
        <SubmitButton pending={launching} pendingLabel="Opening…">
          Open in Claude Code
        </SubmitButton>
      </div>
    </Form>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" className="launcher__copy" onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}

export function ResumePanel({
  threadId,
  deepLink,
  cliCommand,
  resumeCommand,
  schemeRegistered,
  homeResolved,
}: {
  threadId: number;
  /** null when the control-plane home couldn't be resolved (no launch URL). */
  deepLink: string | null;
  /** null when the control-plane home couldn't be resolved (no copyable command). */
  cliCommand: string | null;
  resumeCommand: string | null;
  schemeRegistered: boolean;
  homeResolved: boolean;
}) {
  // Fire the seeded deep link exactly once, right after launch — only when the handler scheme
  // is registered AND we have a real launch URL (a resolved home). Otherwise navigating there
  // just errors. Guarded per-thread so a reload or a return visit never re-launches.
  const canAutoLaunch = schemeRegistered && homeResolved && deepLink !== null;
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !canAutoLaunch || deepLink === null) return;
    let key: string | null = null;
    try {
      key = `sc-launch-fired-${threadId}`;
      if (sessionStorage.getItem(key)) return;
    } catch {
      // sessionStorage unavailable — fall through and fire once for this mount.
    }
    firedRef.current = true;
    try {
      if (key) sessionStorage.setItem(key, String(Date.now()));
    } catch {
      /* best-effort */
    }
    window.location.href = deepLink;
  }, [threadId, deepLink, canAutoLaunch]);

  return (
    <section className="launcher launcher--resume">
      {!homeResolved ? (
        // Honest config state: no bogus cwd is ever emitted into a launch command (work-099).
        <p className="console__notice launcher__notice">
          The control-plane repo isn't resolved, so the Console can't build a launch command. Set{" "}
          <code>SCOPE_CREEP_HOME</code> to your control-plane path and reload.
        </p>
      ) : canAutoLaunch ? (
        <p className="launcher__hint">
          Opening this thread in Claude Code… If nothing happened,{" "}
          <a className="launcher__open" href={deepLink ?? undefined}>
            open the seeded session
          </a>
          .
        </p>
      ) : (
        <>
          <p className="console__notice launcher__notice">
            Claude Code's <code>claude-cli://</code> URL handler isn't registered on this machine,
            so the Console can't auto-launch it. Run this command to start the seeded session:
          </p>
          {cliCommand ? (
            <div className="launcher__cmdrow">
              <code className="launcher__cmd">{cliCommand}</code>
              <CopyButton text={cliCommand} label="Copy command" />
            </div>
          ) : null}
        </>
      )}

      <div className="launcher__resume">
        <span className="launcher__resume-label">Resume in Claude</span>
        {resumeCommand ? (
          // Precise resume: the session is correlated, so target it directly by UUID. This is
          // the ONLY resume affordance — resume-by-uuid is CLI-only (no deep link exists).
          <div className="launcher__cmdrow">
            <code className="launcher__cmd">{resumeCommand}</code>
            <CopyButton text={resumeCommand} label="Copy resume command" />
          </div>
        ) : (
          // Uncorrelated: the honest "waiting to link" state. A resume affordance must NEVER
          // open a new session (work-100) — the launch above already opened the seeded one, so
          // this slot offers no new-session control, only the promise that the exact
          // `claude --resume <uuid>` appears here once the session's first message lands.
          <p className="launcher__hint launcher__resume-pending">
            Waiting to link this thread to its Claude Code session — the exact{" "}
            <code>claude --resume &lt;uuid&gt;</code> command appears here automatically once the
            session's first message lands.
          </p>
        )}
      </div>
    </section>
  );
}
