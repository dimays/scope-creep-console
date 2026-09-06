import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { formatResetEta, type Interruption } from "~/lib/processing";

/**
 * Shared app-state vocabulary (work-011). One cohesive set of primitives for the three
 * states the Owner must always be able to read: a submit in flight (`SubmitButton` +
 * `Spinner`), an agent/thread/work-item actively in progress (`InProgress`), and the
 * whole backend blocked on a token/rate limit (`InterruptedBanner`). These extend the
 * existing "ORG WORKING / breathing dots" language rather than reinventing it, and every
 * animation respects `prefers-reduced-motion` via CSS.
 */

/** A small inline spinner. Purely decorative — pair it with a text label. */
export function Spinner({ className }: { className?: string }) {
  return <span className={className ? `spinner ${className}` : "spinner"} aria-hidden="true" />;
}

/**
 * A submit button that reflects an in-flight submission: it disables itself, swaps to a
 * pending label, and shows a spinner. Drive `pending` from `useNavigation()` (a `<Form>`)
 * or `useFetcher()`. Keeps the app's one loading vocabulary on every submit.
 */
export function SubmitButton({
  pending,
  children,
  pendingLabel,
  className = "req-submit",
  ...rest
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || rest.disabled}
      aria-busy={pending}
      {...rest}
    >
      {pending ? (
        <span className="btn-pending">
          <Spinner />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * An "in progress" indicator for a work-item / request / thread that's actively being
 * worked. Reuses the breathing-dots motion from the live-reply working indicator so
 * "something is happening" reads the same everywhere.
 */
export function InProgress({
  label = "In progress",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={className ? `inprogress ${className}` : "inprogress"}
      role="status"
      aria-label={label}
    >
      <span className="working__dots" aria-hidden="true">
        <span className="working__dot" />
        <span className="working__dot" />
        <span className="working__dot" />
      </span>
      <span className="inprogress__label">{label}</span>
    </span>
  );
}

/** A "blocked" indicator — work is waiting on something and not progressing. */
export function Blocked({ label = "Blocked", className }: { label?: string; className?: string }) {
  return (
    <span
      className={className ? `blocked-pill ${className}` : "blocked-pill"}
      role="status"
      aria-label={label}
    >
      <span className="blocked-pill__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/**
 * The app-wide interrupted / token-limit banner. Shows the reason and a live countdown to
 * the reset ETA, and — while active — the app shell is greyed out and made inert (see
 * root.tsx). It self-heals: it ticks the countdown, and once the ETA passes (or on a
 * periodic poll) it revalidates so the root loader can confirm processing resumed and drop
 * the banner. No browser refresh required.
 */
export function InterruptedBanner({ interruption }: { interruption: Interruption }) {
  const revalidator = useRevalidator();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // When the ETA has passed, ask the server whether processing resumed (it auto-clears a
  // lapsed interruption). Also poll every 15s in case it resumed early.
  useEffect(() => {
    if (now >= interruption.resetAt && revalidator.state === "idle") {
      revalidator.revalidate();
      return;
    }
    const poll = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 15_000);
    return () => clearInterval(poll);
  }, [now, interruption.resetAt, revalidator]);

  const lapsed = now >= interruption.resetAt;

  return (
    <div className="interrupted" role="alert" aria-live="assertive">
      <span className="interrupted__icon" aria-hidden="true" />
      <div className="interrupted__body">
        <p className="interrupted__title">{interruption.reason}</p>
        <p className="interrupted__detail">
          {interruption.detail ? `${interruption.detail} ` : ""}
          {lapsed ? (
            <span className="interrupted__eta">
              <Spinner /> checking whether processing resumed…
            </span>
          ) : (
            <>
              Controls are paused. Resumes in{" "}
              <strong className="interrupted__eta">
                {formatResetEta(interruption.resetAt, now)}
              </strong>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
