import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A tasteful, accessible confirmation modal (work-049) — the one deliberate gate the Owner
 * asked for before a consequential-but-reversible action, and never `window.confirm`.
 *
 * Honors the console's a11y focus system (work-027): it's a real `role="dialog"` +
 * `aria-modal`, labelled by its title and described by its body; it **traps focus** inside
 * the panel (Tab / Shift+Tab wrap), moves initial focus to the first control, closes on
 * `Escape` or a backdrop click, and **restores focus** to whatever was focused when it
 * opened. The entrance motion lives in the 200ms nobody budgets for and respects
 * `prefers-reduced-motion` via CSS.
 *
 * Headless-ish and action-agnostic: the confirm control is passed as `children` (usually a
 * `<Form>` submit) so the caller owns the mutation; the dialog owns focus, keyboard, and
 * chrome. A candidate to promote into `@scope-creep/design` as a shared primitive once a
 * design-pin bump is in scope.
 */
export function ConfirmDialog({
  title,
  description,
  cancelLabel = "Cancel",
  onCancel,
  children,
}: {
  title: string;
  description?: ReactNode;
  cancelLabel?: string;
  /** Called on Cancel, Escape, or a backdrop click — the caller closes the dialog. */
  onCancel: () => void;
  /** The confirm control (e.g. a `<Form>` submit button). Rendered in the action row. */
  children: ReactNode;
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Remember what had focus so we can restore it when the dialog closes (a11y).
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Initial focus: the first focusable control in the panel (Cancel), so a keyboard user
    // lands inside the trap immediately — never on an accidental page element.
    focusable(panel)[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap the trap at both ends so focus can never leave the dialog.
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="modal-layer">
      {/* The backdrop is a real button (not a clickable div), so dismiss-on-click is
          keyboard-operable and screen-reader-labelled. Escape also dismisses (see effect). */}
      <button
        type="button"
        className="modal-backdrop"
        aria-label={cancelLabel}
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="modal__desc">
            {description}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The tab-order-focusable elements inside a container (buttons, links, fields). */
function focusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const sel =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}
