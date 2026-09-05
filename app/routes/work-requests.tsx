import { Form, Link, redirect } from "react-router";
import { WorkNav } from "~/components/work-nav";
import { createRequest, listRequests } from "~/lib/requests.server";
import type { Route } from "./+types/work-requests";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Work Requests · Scope Creep" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { requests: await listRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const title = String(form.get("title") ?? "")
    .trim()
    .slice(0, 200);
  const body = String(form.get("body") ?? "")
    .trim()
    .slice(0, 5000);
  if (!title || !body) return { ok: false };
  const row = await createRequest(title, body);
  return redirect(`/work/requests/${row.id}`);
}

export default function WorkRequests({ loaderData }: Route.ComponentProps) {
  const { requests } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Scope Creep</p>
          <h1 className="console__title">Requests</h1>
        </div>
        <p className="console__meta">submit a request — it gets triaged, not lost</p>
      </header>
      <WorkNav />

      <Form method="post" className="req-form">
        <input name="title" className="req-input" placeholder="Request title" required />
        <textarea
          name="body"
          className="req-textarea"
          placeholder="Describe what you'd like — I'll decline, refine, route, or ticket it."
          required
        />
        <div className="req-actions">
          <button type="submit" className="req-submit">
            Submit request
          </button>
        </div>
      </Form>

      <section className="doc-group">
        <h2 className="doc-group__title">Threads</h2>
        {requests.length === 0 ? (
          <p className="console__empty">No requests yet.</p>
        ) : (
          <ul className="console__list">
            {requests.map((req) => (
              <li key={req.id} className="doc-row">
                <Link to={`/work/requests/${req.id}`} className="console__item-name">
                  {req.title}
                </Link>
                <span className={`tag req-status--${req.status}`}>{req.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
