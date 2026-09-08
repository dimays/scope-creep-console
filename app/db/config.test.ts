import { describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_URL, isRemoteUrl, resolveDbConfig } from "./config";

describe("isRemoteUrl (work-065, ADR-024)", () => {
  it("treats file / in-memory / bare paths as local", () => {
    expect(isRemoteUrl("file:./data/app.db")).toBe(false);
    expect(isRemoteUrl(":memory:")).toBe(false);
    expect(isRemoteUrl("./data/app.db")).toBe(false);
  });

  it("treats libsql:// and http(s)/ws(s) endpoints as remote", () => {
    expect(isRemoteUrl("libsql://scope-creep-console.turso.io")).toBe(true);
    expect(isRemoteUrl("https://scope-creep-console.turso.io")).toBe(true);
    expect(isRemoteUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isRemoteUrl("wss://scope-creep-console.turso.io")).toBe(true);
  });
});

describe("resolveDbConfig (work-065, ADR-024)", () => {
  it("defaults to the local file db when DATABASE_URL is unset (INVARIANTS §9)", () => {
    const cfg = resolveDbConfig({});
    expect(cfg.url).toBe(DEFAULT_DATABASE_URL);
    expect(cfg.remote).toBe(false);
    expect(cfg.authToken).toBeUndefined();
  });

  it("keeps local dev on a file db and ignores a stray token", () => {
    const cfg = resolveDbConfig({ DATABASE_URL: "file:./data/app.db", DATABASE_AUTH_TOKEN: "x" });
    expect(cfg.remote).toBe(false);
    expect(cfg.authToken).toBeUndefined();
  });

  it("carries the scoped token for a remote endpoint", () => {
    const cfg = resolveDbConfig({
      DATABASE_URL: "libsql://scope-creep-console.turso.io",
      DATABASE_AUTH_TOKEN: "tok_abc",
    });
    expect(cfg.remote).toBe(true);
    expect(cfg.url).toBe("libsql://scope-creep-console.turso.io");
    expect(cfg.authToken).toBe("tok_abc");
  });

  it("REFUSES a remote endpoint with no token — never a silent tokenless connect or local fallback", () => {
    expect(() =>
      resolveDbConfig({ DATABASE_URL: "libsql://scope-creep-console.turso.io" }),
    ).toThrow(/DATABASE_AUTH_TOKEN/);
  });

  it("treats a blank/whitespace token as missing for a remote endpoint", () => {
    expect(() =>
      resolveDbConfig({ DATABASE_URL: "libsql://x.turso.io", DATABASE_AUTH_TOKEN: "   " }),
    ).toThrow(/DATABASE_AUTH_TOKEN/);
  });
});
