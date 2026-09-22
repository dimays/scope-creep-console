import { describe, expect, it } from "vitest";
import type { DbConfig } from "~/db/config";
import { assertLocalTestDb } from "./guard-local-db";

/**
 * work-115 — proves the guard logic IN ISOLATION, with hand-built configs. We cannot prove it
 * via the ambient env inside a running vitest process, because vitest's own `test.env` pins the
 * db vars to `:memory:` (that is the whole point — the pins mask an ambient value in-runner). So
 * the belt is verified here directly: given a remote config, the guard must throw; given a local
 * config, it must pass. The setupFiles instance of the guard runs against the real (pinned)
 * resolution and simply must not throw — which is asserted implicitly by this suite running at all.
 */
describe("assertLocalTestDb (work-115 belt)", () => {
  const remote: DbConfig = {
    url: "https://prod-store.turso.io",
    authToken: "scoped-token",
    remote: true,
  };

  it("throws on a remote libSQL config, naming the offending url and work-115", () => {
    expect(() => assertLocalTestDb(remote)).toThrowError(/work-115/);
    expect(() => assertLocalTestDb(remote)).toThrowError(/prod-store\.turso\.io/);
    expect(() => assertLocalTestDb(remote)).toThrowError(/never target a remote/i);
  });

  it("throws on a non-local url even if the remote flag is (wrongly) false", () => {
    // Defense in depth: a bare url that is neither :memory: nor file: is refused regardless of
    // how `remote` was computed.
    const sneaky: DbConfig = { url: "libsql://sneaky.turso.io", remote: false };
    expect(() => assertLocalTestDb(sneaky)).toThrow();
  });

  it("passes an in-memory config unchanged", () => {
    const mem: DbConfig = { url: ":memory:", remote: false };
    expect(assertLocalTestDb(mem)).toBe(mem);
  });

  it("passes a local file: config unchanged", () => {
    const file: DbConfig = { url: "file:./data/app.db", remote: false };
    expect(assertLocalTestDb(file)).toBe(file);
  });
});
