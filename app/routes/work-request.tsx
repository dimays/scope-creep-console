import { Form } from "react-router";
import { WorkNav } from "~/components/work-nav";
import { addMessage, getRequest } from "~/lib/requests.server";
import type { Route } from "./+types/work-request";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Request #${params.id} · Scope Creep` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const thread = await getRequest(Number(params.id));
  if (!thread) throw new Response("Not found", { status: 404 });
  return thread;
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const body = String(form.get("body") ?? "")
    .trim()
    .slice(0, 5000);
  const author = String(form.get("author") ?? "owner").slice(0, 40) || "owner";
  const status = form.get("status") ? String(form.get("status")).slice(0, 40) : undefined;
  if (body) await addMessage(Number(params.id), author, body, status);
  return { ok: true };
}

export default function WorkRequest({ loaderData }: Route.ComponentProps) {
  const { request, messages } = loaderData;
  return (
    <main className="console">
      <header className="console__header">
        <div>
          <p className="console__eyebrow">Request · {request.status}</p>
          <h1 className="console__title">{request.title}</h1>
        </div>
      </header>
      <WorkNav />

      <div className="thread">
        {messages.map((msg) => (
          <div key={msg.id} className={`msg msg--${msg.author === "owner" ? "owner" : "agent"}`}>
            <span className="msg__author">{msg.author}</span>
            <p className="msg__body">{msg.body}</p>
          </div>
        ))}
      </div>

      <Form method="post" className="req-form">
        <textarea name="body" className="req-textarea" placeholder="Add to the thread…" required />
        <div className="req-actions">
          <button type="submit" className="req-submit">
            Reply
          </button>
        </div>
      </Form>
    </main>
  );
}
