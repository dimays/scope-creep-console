import { WorkingIndicator } from "@scope-creep/design";
import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";
import { SubmitButton } from "~/components/state";

/**
 * The Threads launcher UI (work-101/work-102, ADR-016). Two modes:
 *  - `ThreadLauncher` (not launched): the compose form whose Submit opens a NEW Claude Code
 *    session seeded with the typed message. The in-app input lives here and *only* here.
 *  - `ResumePanel` (launched): the in-app input is gone. This is a single, state-driven panel
 *    that shows exactly ONE primary way into the session for the current reality — resume the
 *    correlated session, open the seeded one (auto-fired once), copy the launch command when the
 *    URL handler isn't registered yet, or an honest config prompt when the control-plane home
 *    can't be resolved. "Resume" wording is reserved for the correlated `claude --resume <uuid>`
 *    state; nothing here ever labels a start-new control "Resume" (work-102).
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
    <button
      type="button"
      className="launcher__copy"
      data-copied={copied ? "" : undefined}
      onClick={copy}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** A copyable shell command: the monospace command + its copy affordance, one consistent row. */
function CommandRow({ command, copyLabel }: { command: string; copyLabel: string }) {
  return (
    <div className="launcher__cmdrow">
      <code className="launcher__cmd">{command}</code>
      <CopyButton text={command} label={copyLabel} />
    </div>
  );
}

/**
 * A single subtle line, shown only before the session links up, explaining the one thing that
 * happens next: correlation. Stated ONCE here — the transcript's empty state speaks only to its
 * own turns, so the "waiting" fact is never restated in two boxes (work-104).
 */
function LinkingAside() {
  return (
    <p className="launcher__aside">
      This thread links to its session automatically once the first message lands — the{" "}
      <code>claude --resume</code> command appears here then.
    </p>
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
  // Correlated = the thread is linked to a live session (resume-by-uuid is known). Declared
  // before the auto-launch effect because the gate below depends on it.
  const correlated = resumeCommand !== null;
  // Fire the seeded deep link exactly once, right after launch — only for a launched but
  // NOT-yet-correlated thread, when the handler scheme is registered AND we have a real launch
  // URL (a resolved home). The `!correlated` gate is load-bearing: this is a hook, so it runs
  // regardless of which render branch shows. Without it, revisiting an already-correlated
  // thread in a fresh tab (whose per-thread sessionStorage guard is empty) would navigate to
  // the seeded deepLink and open a NEW session — resurrecting work-102 and corrupting resume
  // (Step 3 must reopen the SAME session). Enter-gated either way, so ADR-016 holds.
  const canAutoLaunch = schemeRegistered && homeResolved && deepLink !== null && !correlated;
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

  // ONE panel, ONE primary affordance per state. The states are mutually exclusive and ordered
  // by what the Owner can actually do right now:
  //   correlated  → Resume the live session (the only true "Resume" — reserved wording, work-102)
  //   auto-launch → the seeded session is opening; a single manual "Open" is the fallback
  //   copy        → the URL handler isn't registered yet; the copyable command is the one action
  //   config      → no resolved home, so no honest command exists — prompt for SCOPE_CREEP_HOME
  // (`correlated` is computed above, ahead of the auto-launch effect that also depends on it.)

  return (
    <section className="launcher launcher--resume" aria-label="Your Claude Code session">
      <span className="launcher__label">Your session</span>

      {!homeResolved ? (
        // Honest config state: no bogus cwd is ever emitted into a launch command (work-101).
        <p className="launcher__notice">
          The control-plane repo isn't resolved, so the Console can't build a launch command. Set{" "}
          <code>SCOPE_CREEP_HOME</code> to your control-plane path and reload.
        </p>
      ) : correlated ? (
        <div className="launcher__body">
          <p className="launcher__lead">This thread is linked to its Claude Code session.</p>
          {/* The correlated resume — target the session directly by UUID. Resume-by-uuid is
              CLI-only (no deep link exists), and this is the ONLY resume affordance; it never
              opens a new session (work-102). */}
          <CommandRow command={resumeCommand} copyLabel="Copy resume command" />
        </div>
      ) : canAutoLaunch ? (
        <div className="launcher__body">
          <p className="launcher__lead">
            <WorkingIndicator className="launcher__spinner" label="Opening in Claude Code" />
            <span>
              Opening this thread in Claude Code… If nothing happened,{" "}
              <a className="launcher__open" href={deepLink ?? undefined}>
                open it manually
              </a>
              .
            </span>
          </p>
          <LinkingAside />
        </div>
      ) : (
        <div className="launcher__body">
          <p className="launcher__lead">
            Claude Code's <code>claude-cli://</code> URL handler isn't registered on this machine
            yet — it installs the first time you start an interactive Claude session. Until then,
            run this to open the seeded session:
          </p>
          {cliCommand ? <CommandRow command={cliCommand} copyLabel="Copy command" /> : null}
          <LinkingAside />
        </div>
      )}
    </section>
  );
}
