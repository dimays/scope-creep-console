import { describe, expect, it } from "vitest";
import { loader as healthzLoader } from "./healthz";
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

describe("route: /work/requests (legacy redirect)", () => {
  it("redirects to /threads", () => {
    const res = requestsRedirect() as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/threads");
  });
});
