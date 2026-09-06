import { describe, expect, it } from "vitest";
import { action as chatProposeAction } from "./chat-propose";
import { loader as healthzLoader } from "./healthz";
import { loader as proposeLoader } from "./propose";
import { action as settingsAction, loader as settingsLoader } from "./settings";
import { action as threadAction, loader as threadLoader } from "./thread";
import { action as threadsAction, loader as threadsLoader } from "./threads";
import { loader as requestsRedirect } from "./work-requests";

// Exercises route loaders/actions end to end against the in-memory db (vitest
// config points DATABASE_URL at :memory:), so a broken loader fails the gate —
// the App-Contract "self-heal oracle" now covers the request/response layer.

describe("route: /healthz", () => {
  it("reports ok with the app version and the db up", async () => {
    const res = await healthzLoader();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: boolean; version: string };
    expect(body.status).toBe("ok");
    expect(body.db).toBe(true);
    expect(typeof body.version).toBe("string");
  });
});

describe("route: /threads (work-029, ADR-012)", () => {
  it("loader returns the threads list", async () => {
    const data = await threadsLoader({} as never);
    expect(Array.isArray(data.threads)).toBe(true);
  });

  it("action rejects empty input", async () => {
    const form = new FormData();
    form.set("title", "");
    form.set("body", "");
    const res = await threadsAction({
      request: new Request("http://localhost/threads", { method: "POST", body: form }),
    } as never);
    expect(res).toEqual({ ok: false });
  });

  it("action opens a thread and redirects to it", async () => {
    const form = new FormData();
    form.set("title", "A test thread");
    form.set("body", "Please do the thing.");
    const res = (await threadsAction({
      request: new Request("http://localhost/threads", { method: "POST", body: form }),
    } as never)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/threads\/\d+$/);
  });
});

describe("route: /threads/:id branching (work-032)", () => {
  // Open a parent thread, then branch a tangent off it through the route action.
  async function openThread(title: string, body: string): Promise<number> {
    const form = new FormData();
    form.set("title", title);
    form.set("body", body);
    const res = (await threadsAction({
      request: new Request("http://localhost/threads", { method: "POST", body: form }),
    } as never)) as Response;
    return Number(res.headers.get("location")?.split("/").pop());
  }

  it("branch intent creates a linked child and redirects to it", async () => {
    const parentId = await openThread("Parent", "Let's discuss.");

    const form = new FormData();
    form.set("intent", "branch");
    form.set("title", "A tangent");
    form.set("body", "This deserves its own thread.");
    const res = (await threadAction({
      request: new Request(`http://localhost/threads/${parentId}`, { method: "POST", body: form }),
      params: { id: String(parentId) },
    } as never)) as Response;

    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toMatch(/^\/threads\/\d+$/);
    const childId = Number(loc.split("/").pop());
    expect(childId).not.toBe(parentId);

    // The child loads with a backlink to the parent; the parent lists the child as a branch.
    const child = await threadLoader({ params: { id: String(childId) } } as never);
    expect(child.parent?.id).toBe(parentId);
    const parent = await threadLoader({ params: { id: String(parentId) } } as never);
    expect(parent.branches.some((b) => b.id === childId)).toBe(true);
  });

  it("branch intent rejects empty input", async () => {
    const parentId = await openThread("Parent 2", "…");
    const form = new FormData();
    form.set("intent", "branch");
    form.set("title", "");
    form.set("body", "");
    const res = await threadAction({
      request: new Request(`http://localhost/threads/${parentId}`, { method: "POST", body: form }),
      params: { id: String(parentId) },
    } as never);
    expect(res).toEqual({ ok: false });
  });
});

describe("route: /settings (work-018 model picker)", () => {
  it("loader returns the catalog and the effective chat model", async () => {
    const data = await settingsLoader({} as never);
    expect(Array.isArray(data.models)).toBe(true);
    expect(typeof data.effective).toBe("string");
    expect(data.effective.length).toBeGreaterThan(0);
  });

  it("action rejects an id not in the catalog", async () => {
    const form = new FormData();
    form.set("chatModel", "claude-not-a-real-model");
    const res = (await settingsAction({
      request: new Request("http://localhost/settings", { method: "POST", body: form }),
    } as never)) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it("action persists a valid catalog id and it drives resolution", async () => {
    const form = new FormData();
    form.set("chatModel", "claude-opus-4-8"); // present in both live catalog and fallback
    const res = (await settingsAction({
      request: new Request("http://localhost/settings", { method: "POST", body: form }),
    } as never)) as { ok: boolean };
    expect(res.ok).toBe(true);
    const data = await settingsLoader({} as never);
    expect(data.effective).toBe("claude-opus-4-8");
    expect(data.effectiveSource).toBe("persisted");
  });

  it("action resets to default when __default__ is chosen", async () => {
    const form = new FormData();
    form.set("chatModel", "__default__");
    const res = (await settingsAction({
      request: new Request("http://localhost/settings", { method: "POST", body: form }),
    } as never)) as { ok: boolean };
    expect(res.ok).toBe(true);
    const data = await settingsLoader({} as never);
    expect(data.effectiveSource).not.toBe("persisted");
  });
});

describe("route: /propose (work-017 flagship)", () => {
  it("loader reports key presence and the effective model", async () => {
    const data = await proposeLoader({} as never);
    // The test env sets ANTHROPIC_API_KEY to "" — the agent runs its offline fallback.
    expect(data.hasKey).toBe(false);
    expect(typeof data.model).toBe("string");
    expect(data.model.length).toBeGreaterThan(0);
  });
});

describe("route: /chat/propose (agent-generated proposals)", () => {
  it("rejects an empty request", async () => {
    const res = (await chatProposeAction({
      request: new Request("http://localhost/chat/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "  " }),
      }),
    } as never)) as Response;
    expect(res.status).toBe(400);
  });

  it("returns a clean no_key result offline — never auto-applies", async () => {
    const res = (await chatProposeAction({
      request: new Request("http://localhost/chat/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Add a footer to the home page" }),
      }),
    } as never)) as Response;
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("no_key");
  });
});

describe("route: /work/requests (legacy redirect)", () => {
  it("redirects to /threads", () => {
    const res = requestsRedirect() as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/threads");
  });
});
