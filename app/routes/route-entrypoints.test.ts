import { describe, expect, it } from "vitest";
import { loader as healthzLoader } from "./healthz";
import { action as settingsAction, loader as settingsLoader } from "./settings";
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

describe("route: /work/requests (legacy redirect)", () => {
  it("redirects to /threads", () => {
    const res = requestsRedirect() as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/threads");
  });
});
