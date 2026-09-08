import { VisuallyHidden } from "@scope-creep/design";
import { Link } from "react-router";
import type { NotificationItem, NotificationKind } from "~/lib/threads";
import { listNotifications } from "~/lib/threads.server";
import type { Route } from "./+types/notifications";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Notifications · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  const notifications = await listNotifications();
  const unread = notifications.filter((n) => n.unread).length;
  return { notifications, unread };
}

/** How each notification kind reads to the Owner (badge caption). */
const KIND_LABEL: Record<NotificationKind, string> = {
  "needs-you": "Waiting on you",
  "needs-input": "Needs you",
  "critical-update": "Update",
};

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { notifications, unread } = loaderData;

  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Notifications</h1>
        </div>
        <p className="console__meta">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
      </header>

      {notifications.length === 0 ? (
        <section className="doc-group">
          <p className="console__empty">
            Nothing needs you right now. Threads the org parks on you and its notable updates show
            up here, newest first.
          </p>
        </section>
      ) : (
        <ul className="notif-list">
          {notifications.map((n) => (
            <NotificationRow key={`${n.kind}:${n.threadId}:${n.ts}`} item={n} />
          ))}
        </ul>
      )}
    </main>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  return (
    <li className={`notif-row${item.unread ? " notif-row--unread" : ""}`}>
      <Link to={item.href} className="notif-row__link">
        <span className={`notif-row__kind notif-row__kind--${item.kind}`}>
          {KIND_LABEL[item.kind]}
        </span>
        <span className="notif-row__label">{item.label}</span>
        <span className="notif-row__thread">{item.title}</span>
        {item.unread ? (
          <>
            <VisuallyHidden>unread</VisuallyHidden>
            <span className="notif-row__dot" aria-hidden="true" />
          </>
        ) : null}
      </Link>
    </li>
  );
}
