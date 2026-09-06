import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";
import { SubmitButton } from "~/components/state";

/**
 * The Threads launcher UI (work-046, ADR-016). Two modes:
 *  - `ThreadLauncher` (not launched): the compose form whose Submit opens a NEW Claude Code
 *    session seeded with the typed message. The in-app input lives here and *only* here.
 *  - `ResumePanel` (launched): the in-app input is gone; this fires the deep link once,
 *    then offers a "Resume in Claude" control plus the copyable fallback command — honest
 *    about whether the `claude-cli:` scheme is actually registered on this machine.
 *
 * Nothing here calls Claude. Opening/resuming is an OS URL-scheme launch (or a copied shell
 * command); the transcript is projected from local session data by the server.
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
  openRepoLink,
  cliCommand,
  resumeCommand,
  schemeRegistered,
  matched,
}: {
  threadId: number;
  deepLink: string;
  openRepoLink: string;
  cliCommand: string;
  resumeCommand: string | null;
  schemeRegistered: boolean;
  matched: boolean;
}) {
  // Fire the seeded deep link exactly once, right after launch, and only if the scheme is
  // actually registered — otherwise navigating to it just errors. Guarded per-thread so a
  // reload or a return visit never re-launches.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !schemeRegistered) return;
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
  }, [threadId, deepLink, schemeRegistered]);

  return (
    <section className="launcher launcher--resume">
      {schemeRegistered ? (
        <p className="launcher__hint">
          Opening this thread in Claude Code… If nothing happened,{" "}
          <a className="launcher__open" href={deepLink}>
            open the seeded session
          </a>
          .
        </p>
      ) : (
        <p className="console__notice launcher__notice">
          The <code>claude-cli:</code> URL scheme isn't registered on this machine, so the Console
          can't auto-launch Claude Code. Run this command to start the seeded session (it registers
          the scheme after its first run):
        </p>
      )}

      {!schemeRegistered ? (
        <div className="launcher__cmdrow">
          <code className="launcher__cmd">{cliCommand}</code>
          <CopyButton text={cliCommand} label="Copy command" />
        </div>
      ) : null}

      <div className="launcher__resume">
        <span className="launcher__resume-label">Resume in Claude</span>
        {resumeCommand ? (
          // Precise resume: the session is correlated, so target it directly by UUID.
          <div className="launcher__cmdrow">
            <code className="launcher__cmd">{resumeCommand}</code>
            <CopyButton text={resumeCommand} label="Copy resume command" />
          </div>
        ) : (
          // Generic-open floor: no session correlated yet, so reopen the repo / start Claude.
          <>
            <p className="launcher__hint">
              {matched
                ? "Session resolved, but its id isn't known yet."
                : "The session isn't correlated yet — it links up automatically once its first message lands. Meanwhile, reopen the repo in Claude Code:"}
            </p>
            {schemeRegistered ? (
              <a className="launcher__open" href={openRepoLink}>
                Open the repo in Claude Code →
              </a>
            ) : (
              <div className="launcher__cmdrow">
                <code className="launcher__cmd">
                  cd {"{control-plane repo}"} && claude --resume
                </code>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
